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
import urllib.request
import urllib.parse
import re
import hashlib

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

# Shared presentation state and active slides directory
_active_slides_dir = None
_cached_state = None
_cached_slide_index = None
_cached_total_slides = None
_notes_cache = {}
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

def download_and_open_ppt(url):
    global _active_slides_dir, _last_exported_presentation, _cached_state, _cached_slide_index, _cached_total_slides, _notes_cache
    if not url:
        return
    try:
        import ssl
        temp_dir = tempfile.gettempdir()

        try:
            ctx = ssl.create_default_context(ssl.CERT_NONE)
        except TypeError:
            ctx = ssl.create_default_context()
            ctx.check_hostname = False
            ctx.verify_mode = ssl.CERT_NONE

        filepath = os.path.abspath(os.path.join(temp_dir, f"activedeck_downloaded_{int(time.time())}.pptx"))

        try:
            with urllib.request.urlopen(url, context=ctx) as resp, open(filepath, "wb") as out_file:
                out_file.write(resp.read())
        except Exception:
            req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"})
            with urllib.request.urlopen(req, context=ctx) as resp, open(filepath, "wb") as out_file:
                out_file.write(resp.read())

        if current_os == "Windows":
            with com_lock:
                pythoncom.CoInitialize()
                try:
                    ppt_app = win32com.client.Dispatch("PowerPoint.Application")
                    ppt_app.Visible = True
                    try:
                        while ppt_app.SlideShowWindows.Count > 0:
                            ppt_app.SlideShowWindows(1).View.Exit()
                    except Exception:
                        pass
                    try:
                        for i in range(ppt_app.Presentations.Count, 0, -1):
                            ppt_app.Presentations(i).Close()
                    except Exception:
                        pass

                    presentation = ppt_app.Presentations.Open(filepath)
                    presentation.SlideShowSettings.Run()
                    try:
                        ppt_app.Activate()
                    except Exception:
                        pass

                    # Setup dedicated directory for this presentation
                    pres_name = presentation.Name
                    pres_hash = hashlib.md5(pres_name.encode('utf-8')).hexdigest()
                    slides_dir = os.path.join(temp_dir, f"activedeck_slides_{pres_hash}")
                    os.makedirs(slides_dir, exist_ok=True)
                    _active_slides_dir = slides_dir

                    # Reset caches
                    _cached_state = None
                    _cached_slide_index = None
                    _cached_total_slides = None
                    _notes_cache.clear()

                    # 1. Ultra-fast Slide 1 export (<0.25s) so the faculty display renders Slide 1 immediately!
                    if presentation.Slides.Count > 0:
                        try:
                            presentation.Slides(1).Export(os.path.join(slides_dir, "Slide1.JPG"), "JPG", 1280, 720)
                        except Exception:
                            pass

                    # 2. Fast whole-presentation native C++ export (~2-3s for 150 slides)
                    try:
                        presentation.Export(slides_dir, "JPG", 1280, 720)
                        _last_exported_presentation = pres_name
                    except Exception:
                        for i in range(1, presentation.Slides.Count + 1):
                            target_jpg = os.path.join(slides_dir, f"Slide{i}.JPG")
                            if not os.path.exists(target_jpg):
                                try:
                                    presentation.Slides(i).Export(target_jpg, "JPG", 1280, 720)
                                except Exception:
                                    pass
                        _last_exported_presentation = pres_name

                finally:
                    pythoncom.CoUninitialize()
    except Exception as e:
        with open(os.path.join(tempfile.gettempdir(), "activedeck_error.log"), "w") as f:
            f.write(f"Error in download_and_open_ppt: {str(e)}")

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
    global _cached_state, _cached_slide_index, _cached_total_slides, _notes_cache, _last_presentation_name, _active_slides_dir
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
                
                # Active directory for slides
                temp_dir = _active_slides_dir or os.path.join(tempfile.gettempdir(), f"activedeck_slides_{hashlib.md5(pres_name.encode('utf-8')).hexdigest()}")
                _active_slides_dir = temp_dir

                # Fetch current slide image as base64 securely
                current_slide_base64 = None
                if current_slide_index > 0:
                    candidates = [
                        os.path.join(temp_dir, f"Slide{current_slide_index}.JPG"),
                        os.path.join(temp_dir, f"{current_slide_index}.jpg"),
                        os.path.join(temp_dir, f"Slide{current_slide_index}.jpg"),
                        os.path.join(temp_dir, f"{current_slide_index}.JPG")
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
                        os.path.join(temp_dir, f"Slide{next_slide_index}.JPG"),
                        os.path.join(temp_dir, f"{next_slide_index}.jpg"),
                        os.path.join(temp_dir, f"Slide{next_slide_index}.jpg"),
                        os.path.join(temp_dir, f"{next_slide_index}.JPG")
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
    global _last_exported_presentation, _cached_state, _cached_slide_index, _cached_total_slides, _notes_cache, _active_slides_dir
    
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
                            temp_dir = os.path.join(tempfile.gettempdir(), f"activedeck_slides_{hashlib.md5(pres_name.encode('utf-8')).hexdigest()}")
                            _active_slides_dir = temp_dir
                            
                            if pres_name != _last_exported_presentation:
                                _cached_state = None
                                _cached_slide_index = None
                                _cached_total_slides = None
                                _notes_cache.clear()
                                os.makedirs(temp_dir, exist_ok=True)
                                
                                count = pres.Slides.Count
                                # Fast Slide 1 export first so faculty display shows slide immediately
                                if count > 0:
                                    try:
                                        pres.Slides(1).Export(os.path.join(temp_dir, "Slide1.JPG"), "JPG", 1280, 720)
                                    except Exception:
                                        pass
                                
                                # Fast native whole-presentation export
                                try:
                                    pres.Export(temp_dir, "JPG", 1280, 720)
                                    _last_exported_presentation = pres_name
                                except Exception:
                                    for i in range(1, count + 1):
                                        target_jpg = os.path.join(temp_dir, f"Slide{i}.JPG")
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
    global _active_slides_dir
    # Check _active_slides_dir or fallback directories - strictly WITHOUT touching COM
    search_dirs = []
    if _active_slides_dir and os.path.exists(_active_slides_dir):
        search_dirs.append(_active_slides_dir)
        
    temp_root = tempfile.gettempdir()
    default_dir = os.path.join(temp_root, "activedeck_slides")
    if default_dir not in search_dirs and os.path.exists(default_dir):
        search_dirs.append(default_dir)
        
    # Also find recently modified activedeck_slides_* directories in temp
    try:
        recent_dirs = sorted(
            [os.path.join(temp_root, d) for d in os.listdir(temp_root) if d.startswith("activedeck_slides_")],
            key=lambda p: os.path.getmtime(p),
            reverse=True
        )
        for rd in recent_dirs:
            if rd not in search_dirs:
                search_dirs.append(rd)
    except Exception:
        pass

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

    for sdir in search_dirs:
        for c in candidates:
            target = os.path.join(sdir, c)
            if os.path.exists(target):
                response = make_response(send_from_directory(sdir, c))
                response.headers['Cache-Control'] = 'public, max-age=86400'
                response.headers['Access-Control-Allow-Origin'] = '*'
                return response

    return jsonify({'error': 'Slide not found'}), 404

def export_slides_now():
    global _active_slides_dir, _last_exported_presentation
    # If slides are already exported in _active_slides_dir, count and return immediately
    if _active_slides_dir and os.path.exists(_active_slides_dir):
        files = [f for f in os.listdir(_active_slides_dir) if f.lower().endswith(('.jpg', '.jpeg'))]
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
                        temp_dir = os.path.join(tempfile.gettempdir(), f"activedeck_slides_{hashlib.md5(pres_name.encode('utf-8')).hexdigest()}")
                        os.makedirs(temp_dir, exist_ok=True)
                        _active_slides_dir = temp_dir
                        
                        files = [f for f in os.listdir(temp_dir) if f.lower().endswith(('.jpg', '.jpeg'))]
                        if len(files) >= pres.Slides.Count:
                            return len(files)
                            
                        # Quick export Slide 1 first
                        if pres.Slides.Count > 0:
                            try:
                                pres.Slides(1).Export(os.path.join(temp_dir, "Slide1.JPG"), "JPG", 1280, 720)
                            except Exception:
                                pass
                        
                        # Whole-presentation native C++ export (~2s)
                        try:
                            pres.Export(temp_dir, "JPG", 1280, 720)
                            _last_exported_presentation = pres_name
                        except Exception:
                            for i in range(1, pres.Slides.Count + 1):
                                target_jpg = os.path.join(temp_dir, f"Slide{i}.JPG")
                                if not os.path.exists(target_jpg):
                                    try:
                                        pres.Slides(i).Export(target_jpg, "JPG", 1280, 720)
                                    except Exception:
                                        pass
                            _last_exported_presentation = pres_name
                            
                        files = [f for f in os.listdir(temp_dir) if f.lower().endswith(('.jpg', '.jpeg'))]
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