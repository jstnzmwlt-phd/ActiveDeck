import platform
import sys
import json
import time
import os
import tempfile
import threading
import base64
import io
import shutil
import ssl
import urllib.request
import urllib.parse
import re

# Safe stdout/stderr redirection when running as windowless background process (pythonw / PyInstaller noconsole)
if sys.stdout is None:
    try:
        log_file = os.path.join(tempfile.gettempdir(), "activedeck_bridge.log")
        sys.stdout = open(log_file, "a", encoding="utf-8")
    except Exception:
        sys.stdout = open(os.devnull, "w")

if sys.stderr is None:
    try:
        log_file = os.path.join(tempfile.gettempdir(), "activedeck_bridge.log")
        sys.stderr = open(log_file, "a", encoding="utf-8")
    except Exception:
        sys.stderr = open(os.devnull, "w")

current_os = platform.system()

if current_os == "Windows":
    import win32com.client
    import pythoncom
elif current_os == "Darwin":
    import subprocess

import logging
from flask import Flask, send_from_directory, make_response, request, jsonify, cli
from flask_sock import Sock

# Silence development server warning from werkzeug/Flask
cli.show_server_banner = lambda *args: None
logging.getLogger('werkzeug').addFilter(lambda record: 'development server' not in record.getMessage())

app = Flask(__name__)
sock = Sock(app)

# Re-entrant lock for ALL COM operations to prevent multithreaded combase.dll 0xc0000005 crashes
com_lock = threading.RLock()

# Shared presentation state and slides directory
SLIDES_DIR = os.path.join(tempfile.gettempdir(), "activedeck_slides")
_cached_state = None
_cached_slide_index = None
_cached_total_slides = None
_notes_cache = {}
_thumbnails_cache = {}
_last_exported_presentation = ""
_last_presentation_name = None

# ---------------------------------------------------------
# 1. MOVEMENT COMMANDS
# ---------------------------------------------------------
def move_ppt_windows(direction):
    with com_lock:
        pythoncom.CoInitialize()
        try:
            ppt_app = win32com.client.GetActiveObject("PowerPoint.Application")
            if ppt_app.SlideShowWindows.Count > 0:
                view = ppt_app.SlideShowWindows(1).View
                old_pos = view.CurrentShowPosition
                if direction == "next":
                    view.Next()
                elif direction == "prev":
                    view.Previous()
                else:
                    try:
                        slide_num = int(direction)
                        presentation = ppt_app.SlideShowWindows(1).Presentation
                        if 1 <= slide_num <= presentation.Slides.Count:
                            view.GotoSlide(slide_num)
                    except ValueError:
                        pass

                # Fast micro-wait for PowerPoint COM to update CurrentShowPosition (up to 120ms max, 10ms steps)
                for _ in range(12):
                    time.sleep(0.01)
                    try:
                        if view.CurrentShowPosition != old_pos:
                            break
                    except Exception:
                        pass
        except Exception:
            pass
        finally:
            pythoncom.CoUninitialize()

def move_ppt_mac(direction):
    if direction == "next":
        script = 'tell application "Microsoft PowerPoint" to go to next slide slide show view of slide show window 1'
    elif direction == "prev":
        script = 'tell application "Microsoft PowerPoint" to go to previous slide slide show view of slide show window 1'
    else:
        try:
            slide_num = int(direction)
            script = f'tell application "Microsoft PowerPoint" to go to slide {slide_num} slide show view of slide show window 1'
        except ValueError:
            return
    try:
        subprocess.run(["osascript", "-e", script], capture_output=True, text=True, check=True)
    except Exception:
        pass

def move_ppt_silently(direction="next"):
    if current_os == "Windows":
        move_ppt_windows(direction)
    elif current_os == "Darwin":
        move_ppt_mac(direction)

def find_local_fallback_ppt(url):
    try:
        parsed = urllib.parse.urlparse(url)
        path = urllib.parse.unquote(parsed.path)
        base = os.path.basename(path)
        clean_name = re.sub(r'^\d+_\d+_', '', base)
        words = [w.lower() for w in re.split(r'[_ -]+', os.path.splitext(clean_name)[0]) if len(w) > 2]

        search_dirs = [
            tempfile.gettempdir(),
            os.path.join(os.path.expanduser("~"), "OneDrive", "Desktop", "JZ"),
            os.path.join(os.path.expanduser("~"), "Desktop", "JZ"),
            os.path.join(os.path.expanduser("~"), "OneDrive", "Desktop"),
            os.path.join(os.path.expanduser("~"), "Desktop"),
        ]

        # 1. Exact or normalized filename match
        for d in search_dirs:
            if not os.path.exists(d):
                continue
            for fname in os.listdir(d):
                if not fname.lower().endswith(('.pptx', '.ppt')):
                    continue
                fpath = os.path.join(d, fname)
                if not os.path.isfile(fpath) or os.path.getsize(fpath) == 0:
                    continue
                if (fname.lower() == clean_name.lower() or 
                    fname.lower().replace(' ', '_') == clean_name.lower() or 
                    clean_name.lower().replace(' ', '_') == fname.lower().replace(' ', '_')):
                    return fpath

        # 2. Temp directory cached presentations matching slide text
        if os.path.exists(tempfile.gettempdir()):
            for fname in os.listdir(tempfile.gettempdir()):
                if fname.lower().startswith(('activedeck_pres_', 'activedeck_downloaded_')) and fname.lower().endswith('.pptx'):
                    fpath = os.path.join(tempfile.gettempdir(), fname)
                    if os.path.isfile(fpath) and os.path.getsize(fpath) > 1000:
                        try:
                            import zipfile, xml.etree.ElementTree as ET
                            with zipfile.ZipFile(fpath) as z:
                                for s in z.namelist():
                                    if 'slide1.xml' in s:
                                        tree = ET.fromstring(z.read(s))
                                        slide_text = ' '.join(tree.itertext()).lower()
                                        if words and any(w in slide_text for w in words):
                                            return fpath
                        except Exception:
                            pass

        # 3. Keyword matching in candidate directories
        for d in search_dirs[1:]:
            if not os.path.exists(d):
                continue
            for fname in os.listdir(d):
                if not fname.lower().endswith(('.pptx', '.ppt')):
                    continue
                fname_lower = fname.lower()
                if words and any(w in fname_lower for w in words):
                    fpath = os.path.join(d, fname)
                    if os.path.isfile(fpath) and os.path.getsize(fpath) > 0:
                        return fpath
    except Exception as e:
        try:
            with open(os.path.join(tempfile.gettempdir(), "activedeck_error.log"), "a") as f:
                f.write(f"\nfind_local_fallback_ppt error: {str(e)}")
        except Exception:
            pass
    return None

def download_and_open_ppt(url):
    global _last_exported_presentation, _cached_state, _cached_slide_index, _cached_total_slides, _thumbnails_cache, _notes_cache
    if not url:
        return
    try:
        filepath = None

        # 1. If already a valid local file path
        if os.path.isfile(url):
            filepath = os.path.abspath(url)
        elif url.startswith(('http://', 'https://')):
            try:
                ctx = ssl._create_unverified_context()
                timestamp = int(time.time())
                candidate_path = os.path.abspath(os.path.join(tempfile.gettempdir(), f"activedeck_pres_{timestamp}.pptx"))

                req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
                with urllib.request.urlopen(req, context=ctx) as resp, open(candidate_path, "wb") as out_file:
                    out_file.write(resp.read())

                if os.path.exists(candidate_path) and os.path.getsize(candidate_path) > 0:
                    filepath = candidate_path
            except Exception as dl_err:
                try:
                    with open(os.path.join(tempfile.gettempdir(), "activedeck_error.log"), "a") as f:
                        f.write(f"\nRemote download failed ({dl_err}), checking local fallback...")
                except Exception:
                    pass

        # 2. Smart local fallback if remote download failed or returned 404
        if not filepath or not os.path.exists(filepath) or os.path.getsize(filepath) == 0:
            fallback = find_local_fallback_ppt(url)
            if fallback and os.path.exists(fallback):
                filepath = fallback
                try:
                    with open(os.path.join(tempfile.gettempdir(), "activedeck_error.log"), "a") as f:
                        f.write(f"\nUsing local fallback file: {filepath}")
                except Exception:
                    pass

        if not filepath or not os.path.exists(filepath) or os.path.getsize(filepath) == 0:
            raise RuntimeError(f"Presentation file could not be downloaded or found locally for url: {url}")

        # Reset state & clear caches
        _last_exported_presentation = ''
        _cached_state = None
        _cached_slide_index = None
        _cached_total_slides = None
        _thumbnails_cache.clear()
        _notes_cache.clear()

        # Delete all .jpg/.JPG files inside activedeck_slides only after we know we have a valid PPT file!
        os.makedirs(SLIDES_DIR, exist_ok=True)
        for f in os.listdir(SLIDES_DIR):
            if f.lower().endswith(('.jpg', '.jpeg')):
                try:
                    os.remove(os.path.join(SLIDES_DIR, f))
                except Exception:
                    pass

        if current_os == "Windows":
            with com_lock:
                pythoncom.CoInitialize()
                try:
                    ppt_app = win32com.client.Dispatch("PowerPoint.Application")
                    ppt_app.Visible = True

                    # Close any existing presentations
                    try:
                        for i in range(ppt_app.Presentations.Count, 0, -1):
                            ppt_app.Presentations(i).Close()
                    except Exception:
                        pass

                    # Open the newly downloaded file with WithWindow=True and immediately start the slideshow
                    presentation = ppt_app.Presentations.Open(filepath, WithWindow=True)
                    presentation.SlideShowSettings.Run()

                    try:
                        ppt_app.Activate()
                    except Exception:
                        pass

                    # Ultra-fast Slide 1 export (<0.25s) so the faculty display renders Slide 1 immediately!
                    if presentation.Slides.Count > 0:
                        try:
                            presentation.Slides(1).Export(os.path.join(SLIDES_DIR, "Slide1.JPG"), "JPG", 1280, 720)
                        except Exception:
                            pass
                finally:
                    pythoncom.CoUninitialize()
    except Exception as e:
        try:
            with open(os.path.join(tempfile.gettempdir(), "activedeck_error.log"), "w") as f:
                f.write(f"Error in download_and_open_ppt: {str(e)}")
        except Exception:
            pass

# ---------------------------------------------------------
# 2. STATE EXTRACTION COMMANDS 
# ---------------------------------------------------------
def get_slide_notes(presentation, slide_index):
    global _notes_cache
    try:
        pres_name = getattr(presentation, 'Name', '')
    except Exception:
        pres_name = ''
    cache_key = (pres_name, slide_index)
    if cache_key in _notes_cache:
        return _notes_cache[cache_key]

    notes_text = ""
    try:
        current_slide = presentation.Slides(slide_index)
        if current_slide.HasNotesPage:
            notes_page = current_slide.NotesPage
            for shape in notes_page.Shapes:
                if shape.Type == 14 and shape.PlaceholderFormat.Type == 2: 
                    if shape.HasTextFrame and shape.TextFrame.HasText:
                        notes_text = shape.TextFrame.TextRange.Text.strip()
                        break
    except Exception:
        pass

    _notes_cache[cache_key] = notes_text
    return notes_text

def get_ppt_state_windows():
    global _cached_state, _cached_slide_index, _cached_total_slides, _notes_cache, _last_presentation_name
    with com_lock:
        pythoncom.CoInitialize()
        try:
            ppt_app = win32com.client.GetActiveObject("PowerPoint.Application")
            if ppt_app.SlideShowWindows.Count > 0:
                presentation = ppt_app.SlideShowWindows(1).Presentation
                view = ppt_app.SlideShowWindows(1).View
                
                pres_name = presentation.Name
                if _last_presentation_name != pres_name:
                    _cached_state = None
                    _cached_slide_index = None
                    _cached_total_slides = None
                    _notes_cache.clear()
                    _last_presentation_name = pres_name

                current_slide_index = view.CurrentShowPosition
                total_slides = presentation.Slides.Count

                # If slide index and total_slides haven't changed, and we have base64 cached, return cache instantly
                if (
                    _cached_state is not None 
                    and _cached_slide_index == current_slide_index 
                    and _cached_total_slides == total_slides
                    and _cached_state.get("current_slide_base64") is not None
                ):
                    return _cached_state

                next_slide_index = current_slide_index + 1 if current_slide_index < total_slides else 0
                
                # Fetch slide notes from memory cache (or on-demand for current slide)
                notes_text = get_slide_notes(presentation, current_slide_index)

                # Fetch current slide image as base64 securely from SLIDES_DIR
                current_slide_base64 = None
                if current_slide_index > 0:
                    candidates = [
                        os.path.join(SLIDES_DIR, f"Slide{current_slide_index}.JPG"),
                        os.path.join(SLIDES_DIR, f"{current_slide_index}.jpg"),
                        os.path.join(SLIDES_DIR, f"Slide{current_slide_index}.jpg"),
                        os.path.join(SLIDES_DIR, f"{current_slide_index}.JPG")
                    ]
                    for c in candidates:
                        if os.path.exists(c):
                            try:
                                with open(c, "rb") as img_file:
                                    current_slide_base64 = "data:image/jpeg;base64," + base64.b64encode(img_file.read()).decode('utf-8')
                                break
                            except Exception:
                                pass

                # Fetch next slide image as base64 securely if it exists
                next_slide_base64 = None
                if next_slide_index > 0:
                    candidates = [
                        os.path.join(SLIDES_DIR, f"Slide{next_slide_index}.JPG"),
                        os.path.join(SLIDES_DIR, f"{next_slide_index}.jpg"),
                        os.path.join(SLIDES_DIR, f"Slide{next_slide_index}.jpg"),
                        os.path.join(SLIDES_DIR, f"{next_slide_index}.JPG")
                    ]
                    for c in candidates:
                        if os.path.exists(c):
                            try:
                                with open(c, "rb") as img_file:
                                    next_slide_base64 = "data:image/jpeg;base64," + base64.b64encode(img_file.read()).decode('utf-8')
                                break
                            except Exception:
                                pass
                                
                state = {
                    "current_slide": current_slide_index,
                    "current_slide_base64": current_slide_base64,
                    "next_slide": next_slide_index if next_slide_index > 0 else 0,
                    "total_slides": total_slides,
                    "notes": notes_text.strip(),
                    "next_slide_base64": next_slide_base64
                }
                _cached_state = state
                _cached_slide_index = current_slide_index
                _cached_total_slides = total_slides
                return state
            else:
                _last_presentation_name = None
                _cached_state = None
                _cached_slide_index = None
                _cached_total_slides = None
        except Exception:
            pass 
        finally:
            pythoncom.CoUninitialize()
    return None

def get_ppt_state_silently():
    if current_os == "Windows":
        return get_ppt_state_windows()
    return None

# ---------------------------------------------------------
# 3. BACKGROUND SLIDE EXPORTER
# ---------------------------------------------------------
def background_slide_exporter():
    global _last_exported_presentation, _cached_state, _cached_slide_index, _cached_total_slides, _notes_cache
    
    while True:
        time.sleep(1)
        if current_os == "Windows":
            with com_lock:
                try:
                    pythoncom.CoInitialize()
                    try:
                        ppt_app = win32com.client.GetActiveObject("PowerPoint.Application")
                        if ppt_app.SlideShowWindows.Count > 0:
                            pres = ppt_app.SlideShowWindows(1).Presentation
                            pres_name = pres.Name
                            
                            if pres_name != _last_exported_presentation:
                                _cached_state = None
                                _cached_slide_index = None
                                _cached_total_slides = None
                                _notes_cache.clear()
                                os.makedirs(SLIDES_DIR, exist_ok=True)
                                
                                count = pres.Slides.Count
                                # Fast Slide 1 export first so faculty display shows slide immediately
                                if count > 0:
                                    try:
                                        pres.Slides(1).Export(os.path.join(SLIDES_DIR, "Slide1.JPG"), "JPG", 1280, 720)
                                    except Exception:
                                        pass
                                
                                # Fast native whole-presentation export
                                try:
                                    pres.Export(SLIDES_DIR, "JPG", 1280, 720)
                                    _last_exported_presentation = pres_name
                                except Exception:
                                    for i in range(1, count + 1):
                                        target_jpg = os.path.join(SLIDES_DIR, f"Slide{i}.JPG")
                                        if not os.path.exists(target_jpg):
                                            try:
                                                pres.Slides(i).Export(target_jpg, "JPG", 1280, 720)
                                            except Exception:
                                                pass
                                    _last_exported_presentation = pres_name
                        else:
                            _last_exported_presentation = ""
                            _cached_state = None
                            _cached_slide_index = None
                            _cached_total_slides = None
                    finally:
                        pythoncom.CoUninitialize()
                except Exception:
                    pass

# ---------------------------------------------------------
# 4. WEBSERVER ROUTES (Images, HTTP Commands & WebSockets)
# ---------------------------------------------------------
@app.before_request
def handle_preflight():
    if request.method == 'OPTIONS':
        response = make_response()
        response.headers['Access-Control-Allow-Origin'] = '*'
        response.headers['Access-Control-Allow-Methods'] = 'GET, POST, PUT, DELETE, OPTIONS'
        response.headers['Access-Control-Allow-Headers'] = '*'
        response.headers['Access-Control-Max-Age'] = '86400'
        return response

@app.after_request
def add_cors_headers(response):
    response.headers['Access-Control-Allow-Origin'] = '*'
    response.headers['Access-Control-Allow-Methods'] = 'GET, POST, PUT, DELETE, OPTIONS'
    response.headers['Access-Control-Allow-Headers'] = '*'
    return response

@app.route('/status', methods=['GET', 'OPTIONS'])
def handle_status():
    state = get_ppt_state_silently() or {}
    return jsonify(state)

@app.route('/load', methods=['POST', 'GET', 'OPTIONS'])
def handle_load_http():
    if request.method == 'POST':
        data = request.get_json(silent=True) or {}
        url = data.get('url') or request.args.get('url')
    else:
        url = request.args.get('url')
    if url:
        threading.Thread(target=download_and_open_ppt, args=(url,), daemon=True).start()
        return jsonify({'status': 'success', 'message': 'Presentation loading initiated'})
    return jsonify({'status': 'error', 'message': 'Missing URL'}), 400

@app.route('/slides/<path:filename>')
def serve_slide(filename):
    if not os.path.exists(SLIDES_DIR):
        return jsonify({'error': 'Slides directory not found'}), 404

    base, ext = os.path.splitext(filename)
    candidates = [filename]
    if base.isdigit():
        candidates = [
            f"Slide{base}.JPG",
            f"Slide{base}.jpg",
            f"{base}.jpg",
            f"{base}.JPG",
            f"{base}.jpeg",
            f"slide{base}.jpg"
        ]

    for c in candidates:
        target = os.path.join(SLIDES_DIR, c)
        if os.path.exists(target):
            response = make_response(send_from_directory(SLIDES_DIR, c))
            response.headers['Cache-Control'] = 'no-cache, no-store, must-revalidate'
            response.headers['Pragma'] = 'no-cache'
            response.headers['Expires'] = '0'
            response.headers['Access-Control-Allow-Origin'] = '*'
            return response

    return jsonify({'error': 'Slide not found'}), 404

def export_slides_now():
    global _last_exported_presentation
    if os.path.exists(SLIDES_DIR):
        files = [f for f in os.listdir(SLIDES_DIR) if f.lower().endswith(('.jpg', '.jpeg'))]
        if files:
            return len(files)

    if current_os == "Windows":
        with com_lock:
            try:
                pythoncom.CoInitialize()
                try:
                    ppt_app = win32com.client.GetActiveObject("PowerPoint.Application")
                    if ppt_app.SlideShowWindows.Count > 0:
                        pres = ppt_app.SlideShowWindows(1).Presentation
                        pres_name = pres.Name
                        os.makedirs(SLIDES_DIR, exist_ok=True)
                        
                        files = [f for f in os.listdir(SLIDES_DIR) if f.lower().endswith(('.jpg', '.jpeg'))]
                        if len(files) >= pres.Slides.Count:
                            return len(files)
                            
                        # Quick export Slide 1 first
                        if pres.Slides.Count > 0:
                            try:
                                pres.Slides(1).Export(os.path.join(SLIDES_DIR, "Slide1.JPG"), "JPG", 1280, 720)
                            except Exception:
                                pass
                        
                        # Whole-presentation native C++ export (~2s)
                        try:
                            pres.Export(SLIDES_DIR, "JPG", 1280, 720)
                            _last_exported_presentation = pres_name
                        except Exception:
                            for i in range(1, pres.Slides.Count + 1):
                                target_jpg = os.path.join(SLIDES_DIR, f"Slide{i}.JPG")
                                if not os.path.exists(target_jpg):
                                    try:
                                        pres.Slides(i).Export(target_jpg, "JPG", 1280, 720)
                                    except Exception:
                                        pass
                            _last_exported_presentation = pres_name
                            
                        files = [f for f in os.listdir(SLIDES_DIR) if f.lower().endswith(('.jpg', '.jpeg'))]
                        return len(files)
                finally:
                    pythoncom.CoUninitialize()
            except Exception:
                pass
    return 0

@app.route('/export', methods=['GET', 'POST', 'OPTIONS'])
def handle_export_route():
    count = export_slides_now()
    return jsonify({'success': True, 'count': count})

@app.route('/<direction>', methods=['GET', 'POST', 'OPTIONS'])
def handle_direction_http(direction):
    if direction not in ['slides', 'ws', 'status', 'load', 'export']:
        move_ppt_silently(direction)
        return jsonify({'status': 'success', 'direction': direction})
    return jsonify({'status': 'ignored'})

def handle_ws(ws):
    last_state = None
    while True:
        force_send = False
        try:
            # Short 50ms timeout for near-instant responsiveness without busy-waiting
            message = ws.receive(timeout=0.05)
            if message:
                try:
                    payload = json.loads(message)
                    if isinstance(payload, dict):
                        action = payload.get('action')
                        if action == 'move':
                            direction = payload.get('direction', 'next')
                            move_ppt_silently(direction)
                            force_send = True
                        elif action == 'load':
                            url = payload.get('url')
                            if url:
                                threading.Thread(target=download_and_open_ppt, args=(url,), daemon=True).start()
                                force_send = True
                        elif action == 'get_thumbnails':
                            pass
                        elif action == 'status':
                            force_send = True
                    else:
                        move_ppt_silently(str(payload))
                        force_send = True
                except (json.JSONDecodeError, TypeError):
                    if message == 'status':
                        force_send = True
                    else:
                        move_ppt_silently(message)
                        force_send = True
        except Exception:
            pass

        state = get_ppt_state_silently()

        if state and (state != last_state or force_send):
            try:
                ws.send(json.dumps(state))
                last_state = state
            except Exception:
                break
        elif not state and last_state is not None:
            try:
                ws.send(json.dumps({
                    "current_slide": 0,
                    "current_slide_base64": None,
                    "next_slide": 0,
                    "next_slide_base64": None,
                    "total_slides": 0,
                    "notes": "",
                    "status": "idle"
                }))
                last_state = None
            except Exception:
                break

@sock.route('/ws')
def _handle_ws_route(ws):
    handle_ws(ws)

if __name__ == '__main__':
    exporter_thread = threading.Thread(target=background_slide_exporter, daemon=True)
    exporter_thread.start()
    print("=" * 60)
    print("  ActiveDeck Bridge v3.1 - Running (Stabilized & Accelerated)")
    print("  Local Server: http://127.0.0.1:5000")
    print("  WebSocket:    ws://127.0.0.1:5000/ws")
    print("  PowerPoint:   COM Auto-Detection Active (Thread-Safe)")
    print("  Keep this window open while presenting.")
    print("=" * 60)
    app.run(host='127.0.0.1', port=5000)