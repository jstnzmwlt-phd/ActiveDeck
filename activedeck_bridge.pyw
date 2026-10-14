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

# ---------------------------------------------------------
# 1. MOVEMENT COMMANDS
# ---------------------------------------------------------
def move_ppt_windows(direction):
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

            # Fast micro-wait for PowerPoint COM to update CurrentShowPosition (up to 150ms max, 10ms steps)
            for _ in range(15):
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

def move_ppt_silently(direction):
    if current_os == "Windows":
        move_ppt_windows(direction)
    elif current_os == "Darwin":
        move_ppt_mac(direction)

def download_and_open_ppt(url):
    if not url:
        return
    try:
        temp_dir = tempfile.gettempdir()
        filename = "active_deck_presentation.pptx"
        try:
            parsed_path = urllib.parse.urlparse(url).path
            base_name = os.path.basename(parsed_path)
            if base_name and base_name.lower().endswith((".pptx", ".ppt")):
                filename = base_name
        except Exception:
            pass

        filepath = os.path.abspath(os.path.join(temp_dir, filename))

        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"})
        with urllib.request.urlopen(req) as resp, open(filepath, "wb") as out_file:
            out_file.write(resp.read())

        if current_os == "Windows":
            pythoncom.CoInitialize()
            try:
                try:
                    ppt_app = win32com.client.GetActiveObject("PowerPoint.Application")
                except Exception:
                    ppt_app = win32com.client.Dispatch("PowerPoint.Application")

                ppt_app.Visible = True
                presentation = ppt_app.Presentations.Open(filepath)
                presentation.SlideShowSettings.Run()

                try:
                    ppt_app.Activate()
                    if ppt_app.SlideShowWindows.Count > 0:
                        ppt_app.SlideShowWindows(1).Activate()
                except Exception:
                    pass
                print(f"[ActiveDeck Bridge] Successfully opened presentation: {filepath}")
            finally:
                pythoncom.CoUninitialize()
    except Exception as e:
        print(f"[ActiveDeck Bridge] Error in download_and_open_ppt: {e}")


# ---------------------------------------------------------
# 2. STATE EXTRACTION COMMANDS 
# ---------------------------------------------------------
_cached_state = None
_cached_slide_index = None
_cached_total_slides = None
_notes_cache = {}
_thumbnails_cache = {}
_thumbnails_version = 0
_last_exported_presentation = ""

def update_thumbnails_cache(temp_dir):
    global _thumbnails_cache, _thumbnails_version
    thumbs = {}
    if os.path.exists(temp_dir):
        for f in sorted(os.listdir(temp_dir)):
            if f.endswith('.jpg') and f.replace('.jpg', '').isdigit():
                s_num = int(f.replace('.jpg', ''))
                fpath = os.path.join(temp_dir, f)
                try:
                    data_bytes = None
                    try:
                        from PIL import Image
                        im = Image.open(fpath)
                        im.thumbnail((320, 180))
                        buf = io.BytesIO()
                        im.save(buf, format='JPEG', quality=65)
                        data_bytes = buf.getvalue()
                    except Exception:
                        with open(fpath, 'rb') as fp:
                            data_bytes = fp.read()
                    if data_bytes:
                        thumbs[s_num] = 'data:image/jpeg;base64,' + base64.b64encode(data_bytes).decode('utf-8')
                except Exception:
                    pass
    if thumbs:
        _thumbnails_cache = thumbs
        _thumbnails_version += 1
        print(f"[ActiveDeck Bridge] Cached {len(thumbs)} slide thumbnails (version {_thumbnails_version})")

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

def preload_all_notes(presentation):
    global _notes_cache
    try:
        pres_name = getattr(presentation, 'Name', '')
        for idx in range(1, presentation.Slides.Count + 1):
            cache_key = (pres_name, idx)
            if cache_key not in _notes_cache:
                get_slide_notes(presentation, idx)
    except Exception:
        pass

def get_ppt_state_windows():
    global _cached_state, _cached_slide_index, _cached_total_slides
    pythoncom.CoInitialize()
    try:
        ppt_app = win32com.client.GetActiveObject("PowerPoint.Application")
        if ppt_app.SlideShowWindows.Count > 0:
            presentation = ppt_app.SlideShowWindows(1).Presentation
            view = ppt_app.SlideShowWindows(1).View
            
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
            
            # Fetch slide notes instantly from memory cache
            notes_text = get_slide_notes(presentation, current_slide_index)
            # Fetch current slide image as base64 securely
            current_slide_base64 = None
            if current_slide_index > 0:
                temp_dir = os.path.join(tempfile.gettempdir(), "activedeck_slides")
                current_image_path = os.path.join(temp_dir, f"{current_slide_index}.jpg")
                if not os.path.exists(current_image_path):
                    current_image_path = os.path.join(temp_dir, f"Slide{current_slide_index}.JPG")
                if os.path.exists(current_image_path):
                    try:
                        with open(current_image_path, "rb") as img_file:
                            current_slide_base64 = "data:image/jpeg;base64," + base64.b64encode(img_file.read()).decode('utf-8')
                    except Exception:
                        pass

            # Fetch next slide image as base64 securely if it exists to bypass HTTPS mixed content blocking
            next_slide_base64 = None
            if next_slide_index > 0:
                temp_dir = os.path.join(tempfile.gettempdir(), "activedeck_slides")
                next_image_path = os.path.join(temp_dir, f"{next_slide_index}.jpg")
                if not os.path.exists(next_image_path):
                    next_image_path = os.path.join(temp_dir, f"Slide{next_slide_index}.JPG")
                if os.path.exists(next_image_path):
                    try:
                        with open(next_image_path, "rb") as img_file:
                            next_slide_base64 = "data:image/jpeg;base64," + base64.b64encode(img_file.read()).decode('utf-8')
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
# 3. BACKGROUND SLIDE EXPORTER (Fixed for Subfolders & Frontend Mismatches)
# ---------------------------------------------------------
def background_slide_exporter():
    global _last_exported_presentation, _cached_state, _cached_slide_index, _cached_total_slides, _notes_cache
    temp_dir = os.path.join(tempfile.gettempdir(), "activedeck_slides")
    
    while True:
        time.sleep(1)
        if current_os == "Windows":
            try:
                pythoncom.CoInitialize()
                ppt_app = win32com.client.GetActiveObject("PowerPoint.Application")
                
                if ppt_app.SlideShowWindows.Count > 0:
                    pres = ppt_app.SlideShowWindows(1).Presentation
                    
                    if pres.Name != _last_exported_presentation:
                        _cached_state = None
                        _cached_slide_index = None
                        _cached_total_slides = None
                        _notes_cache.clear()
                        preload_all_notes(pres)
                        os.makedirs(temp_dir, exist_ok=True)
                        for f in os.listdir(temp_dir):
                            if f.lower().endswith(('.jpg', '.jpeg', '.png')):
                                try:
                                    os.remove(os.path.join(temp_dir, f))
                                except Exception:
                                    pass
                        count = pres.Slides.Count
                        # Try fast whole-presentation export first (~1s in native C++)
                        exported_all = False
                        try:
                            pres.Export(temp_dir, "JPG")
                            exported_all = True
                        except Exception:
                            pass

                        if exported_all:
                            for i in range(1, count + 1):
                                slide_jpg = os.path.join(temp_dir, f"Slide{i}.JPG")
                                num_jpg = os.path.join(temp_dir, f"{i}.jpg")
                                if os.path.exists(slide_jpg) and not os.path.exists(num_jpg):
                                    try:
                                        shutil.copyfile(slide_jpg, num_jpg)
                                    except Exception:
                                        pass
                                elif os.path.exists(num_jpg) and not os.path.exists(slide_jpg):
                                    try:
                                        shutil.copyfile(num_jpg, slide_jpg)
                                    except Exception:
                                        pass
                        else:
                            for i in range(1, count + 1):
                                slide = pres.Slides(i)
                                target_jpg = os.path.join(temp_dir, f"{i}.jpg")
                                slide.Export(target_jpg, "JPG")
                                try:
                                    shutil.copyfile(target_jpg, os.path.join(temp_dir, f"Slide{i}.JPG"))
                                except Exception:
                                    pass
                                time.sleep(0.005)
                            
                        update_thumbnails_cache(temp_dir)
                        _last_exported_presentation = pres.Name
                else:
                    _last_exported_presentation = ""
                    _cached_state = None
                    _cached_slide_index = None
                    _cached_total_slides = None
            except Exception:
                pass
            finally:
                pythoncom.CoUninitialize()

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
    temp_dir = os.path.join(tempfile.gettempdir(), "activedeck_slides")
    target = os.path.join(temp_dir, filename)
    if not os.path.exists(target):
        base, ext = os.path.splitext(filename)
        candidates = [f"Slide{base}.JPG", f"Slide{base}.jpg", f"{base}.JPG", f"{base}.jpeg", f"slide{base}.jpg"]
        for c in candidates:
            if os.path.exists(os.path.join(temp_dir, c)):
                filename = c
                break
    response = make_response(send_from_directory(temp_dir, filename))
    response.headers['Cache-Control'] = 'no-cache, no-store, must-revalidate, max-age=0'
    response.headers['Pragma'] = 'no-cache'
    response.headers['Expires'] = '0'
    return response

def export_slides_now():
    temp_dir = os.path.join(tempfile.gettempdir(), "activedeck_slides")
    count = 0
    if current_os == "Windows":
        pythoncom.CoInitialize()
        try:
            ppt_app = win32com.client.GetActiveObject("PowerPoint.Application")
            if ppt_app.SlideShowWindows.Count > 0:
                pres = ppt_app.SlideShowWindows(1).Presentation
                os.makedirs(temp_dir, exist_ok=True)
                count = pres.Slides.Count
                
                # Preload all slide notes into memory so navigation notes are instant
                preload_all_notes(pres)

                # Check if all slides already exist on disk to prevent blocking COM
                existing = [f for f in os.listdir(temp_dir) if f.endswith('.jpg') and not f.startswith('Slide')]
                if len(existing) >= count:
                    return count

                for i in range(1, count + 1):
                    target_jpg = os.path.join(temp_dir, f"{i}.jpg")
                    if not os.path.exists(target_jpg):
                        slide = pres.Slides(i)
                        slide.Export(target_jpg, "JPG")
                        try:
                            import shutil
                            shutil.copyfile(target_jpg, os.path.join(temp_dir, f"Slide{i}.JPG"))
                        except Exception:
                            pass
                        time.sleep(0.005)
        except Exception:
            pass
        finally:
            pythoncom.CoUninitialize()
    if count == 0 and os.path.exists(temp_dir):
        jpgs = [f for f in os.listdir(temp_dir) if f.endswith('.jpg') and not f.startswith('Slide')]
        count = len(jpgs)
    return count

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

@sock.route('/ws')
def handle_ws(ws):
    last_state = None
    last_sent_thumbnails_version = 0
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
                            if _thumbnails_cache:
                                ws.send(json.dumps({
                                    "type": "THUMBNAILS",
                                    "version": _thumbnails_version,
                                    "thumbnails": _thumbnails_cache
                                }))
                                last_sent_thumbnails_version = _thumbnails_version
                        elif action == 'status':
                            force_send = True
                    else:
                        move_ppt_silently(str(payload))
                        force_send = True
                except (json.JSONDecodeError, TypeError):
                    if message == 'status':
                        force_send = True
                    elif message == 'get_thumbnails':
                        if _thumbnails_cache:
                            ws.send(json.dumps({
                                "type": "THUMBNAILS",
                                "version": _thumbnails_version,
                                "thumbnails": _thumbnails_cache
                            }))
                            last_sent_thumbnails_version = _thumbnails_version
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

        # Send slide thumbnails as soon as they are ready
        if _thumbnails_cache and _thumbnails_version != last_sent_thumbnails_version:
            try:
                ws.send(json.dumps({
                    "type": "THUMBNAILS",
                    "version": _thumbnails_version,
                    "thumbnails": _thumbnails_cache
                }))
                last_sent_thumbnails_version = _thumbnails_version
            except Exception:
                break

if __name__ == '__main__':
    temp_dir = os.path.join(tempfile.gettempdir(), "activedeck_slides")
    update_thumbnails_cache(temp_dir)
    exporter_thread = threading.Thread(target=background_slide_exporter, daemon=True)
    exporter_thread.start()
    print("=" * 60)
    print("  ActiveDeck Bridge v3.0 - Running")
    print("  Local Server: http://127.0.0.1:5000")
    print("  WebSocket:    ws://127.0.0.1:5000/ws")
    print("  PowerPoint:   COM Auto-Detection Active")
    print("  Keep this window open while presenting.")
    print("=" * 60)
    app.run(host='127.0.0.1', port=5000)