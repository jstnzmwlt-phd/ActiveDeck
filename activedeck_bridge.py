import platform
import sys
import json
import time
import os
import tempfile
import threading
import queue
import base64
import io
import shutil
import ssl
import urllib.request
import urllib.parse
import hashlib
import subprocess
import logging

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

from flask import Flask, send_from_directory, make_response, request, jsonify, cli
from flask_sock import Sock

# Silence development server warning from werkzeug/Flask
cli.show_server_banner = lambda *args: None
logging.getLogger('werkzeug').addFilter(lambda record: 'development server' not in record.getMessage())

app = Flask(__name__)
sock = Sock(app)

# ---------------------------------------------------------
# GLOBAL STATE & CACHES (Thread-safe read access)
# ---------------------------------------------------------
_bridge_state = None  # Dict of current presentation state
_current_slides_dir = os.path.join(tempfile.gettempdir(), "activedeck_slides")
_notes_cache = {}
_thumbnails_cache = {}
_thumbnails_version = 0

# Command queue to serialize all PPT COM operations onto a single dedicated STA worker thread
ppt_cmd_queue = queue.Queue()


def com_retry(func, max_attempts=6, delay=0.5):
    last_err = None
    for attempt in range(max_attempts):
        try:
            return func()
        except Exception as e:
            last_err = e
            time.sleep(delay)
    raise last_err


def load_slide_base64(temp_dir, slide_num):
    if slide_num <= 0 or not os.path.exists(temp_dir):
        return None
    for fname in [f"{slide_num}.jpg", f"Slide{slide_num}.JPG", f"{slide_num}.jpeg"]:
        p = os.path.join(temp_dir, fname)
        if os.path.exists(p):
            try:
                sz = os.path.getsize(p)
                if sz > 0:
                    with open(p, "rb") as f:
                        return "data:image/jpeg;base64," + base64.b64encode(f.read()).decode('utf-8')
            except Exception:
                pass
    return None


def preload_all_notes(pres, pres_name):
    global _notes_cache
    try:
        count = pres.Slides.Count
        for idx in range(1, count + 1):
            cache_key = (pres_name, idx)
            if cache_key in _notes_cache:
                continue
            notes_text = ""
            try:
                slide = pres.Slides(idx)
                if slide.HasNotesPage:
                    notes_page = slide.NotesPage
                    for shape in notes_page.Shapes:
                        if shape.Type == 14 and shape.PlaceholderFormat.Type == 2:
                            if shape.HasTextFrame and shape.TextFrame.HasText:
                                notes_text = shape.TextFrame.TextRange.Text.strip()
                                break
            except Exception:
                pass
            _notes_cache[cache_key] = notes_text
    except Exception:
        pass


def update_thumbnails_cache(temp_dir):
    global _thumbnails_cache, _thumbnails_version
    if not os.path.exists(temp_dir):
        return
    thumbs = {}
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


# ---------------------------------------------------------
# DEDICATED PPT CONTROLLER WORKER (Zero COM Cross-Threading)
# ---------------------------------------------------------
def ppt_controller_worker():
    global _bridge_state, _current_slides_dir, _thumbnails_cache, _thumbnails_version, _notes_cache

    if current_os == "Windows":
        pythoncom.CoInitialize()

    ppt_app = None
    last_pres_name = None
    last_slide_pos = None

    def get_ppt():
        nonlocal ppt_app
        if ppt_app is not None:
            try:
                _ = ppt_app.Name
                return ppt_app
            except Exception:
                ppt_app = None
        if current_os == "Windows":
            try:
                ppt_app = win32com.client.GetActiveObject("PowerPoint.Application")
                return ppt_app
            except Exception:
                pass
            try:
                ppt_app = win32com.client.Dispatch("PowerPoint.Application")
                try:
                    ppt_app.Visible = True
                except Exception:
                    pass
                return ppt_app
            except Exception:
                ppt_app = None
                return None
        return None

    while True:
        try:
            # 1. Process any queued commands from WebSockets or HTTP
            while not ppt_cmd_queue.empty():
                try:
                    cmd = ppt_cmd_queue.get_nowait()
                except queue.Empty:
                    break

                cmd_type = cmd[0]
                if cmd_type == 'move':
                    direction = cmd[1]
                    if current_os == "Windows":
                        app = get_ppt()
                        if app:
                            try:
                                if app.SlideShowWindows.Count > 0:
                                    view = app.SlideShowWindows(1).View
                                    if direction == "next":
                                        view.Next()
                                    elif direction == "prev":
                                        view.Previous()
                                    else:
                                        try:
                                            s_num = int(direction)
                                            pres = app.SlideShowWindows(1).Presentation
                                            if 1 <= s_num <= pres.Slides.Count:
                                                view.GotoSlide(s_num)
                                        except ValueError:
                                            pass
                            except Exception:
                                pass
                    elif current_os == "Darwin":
                        move_ppt_mac(direction)

                elif cmd_type == 'open_filepath':
                    filepath = cmd[1]
                    if current_os == "Windows":
                        app = get_ppt()
                        if app:
                            try:
                                try:
                                    app.Visible = True
                                except Exception:
                                    pass
                                time.sleep(0.2)
                                try:
                                    app.DisplayAlerts = 1  # ppAlertsNone
                                except Exception:
                                    pass
                                # Exit running slideshows
                                try:
                                    while app.SlideShowWindows.Count > 0:
                                        try:
                                            app.SlideShowWindows(1).View.Exit()
                                        except Exception:
                                            break
                                        time.sleep(0.15)
                                except Exception:
                                    pass
                                # Close open presentations
                                try:
                                    for i in range(app.Presentations.Count, 0, -1):
                                        try:
                                            p = app.Presentations(i)
                                            p.Saved = True
                                            p.Close()
                                        except Exception:
                                            pass
                                        time.sleep(0.1)
                                except Exception:
                                    pass
                                time.sleep(0.3)
                                pres = com_retry(lambda: app.Presentations.Open(filepath), max_attempts=6, delay=0.5)
                                time.sleep(0.3)
                                com_retry(lambda: pres.SlideShowSettings.Run(), max_attempts=6, delay=0.5)
                                print(f"[ActiveDeck Bridge] Launched presentation in PowerPoint: {pres.Name} ({pres.Slides.Count} slides)")
                                try:
                                    app.Activate()
                                except Exception:
                                    pass
                            except Exception as e:
                                import traceback
                                err_msg = f"Error in open_filepath: {str(e)}\n{traceback.format_exc()}"
                                print(f"[ActiveDeck Bridge] {err_msg}")
                                with open(os.path.join(tempfile.gettempdir(), "activedeck_error.log"), "w") as f:
                                    f.write(err_msg)

            # 2. Poll PowerPoint State
            app = get_ppt()
            has_slideshow = False
            if app and current_os == "Windows":
                try:
                    if app.SlideShowWindows.Count > 0:
                        has_slideshow = True
                        pres = app.SlideShowWindows(1).Presentation
                        view = app.SlideShowWindows(1).View
                        pres_name = pres.Name
                        cur_pos = view.CurrentShowPosition
                        total_slides = pres.Slides.Count

                        # If presentation changed:
                        if pres_name != last_pres_name:
                            print(f"[ActiveDeck Bridge] Presentation detected: {pres_name}")
                            temp_dir = os.path.join(tempfile.gettempdir(), f"activedeck_slides_{hashlib.md5(pres_name.encode('utf-8')).hexdigest()}")
                            _current_slides_dir = temp_dir
                            os.makedirs(temp_dir, exist_ok=True)

                            for f in os.listdir(temp_dir):
                                if f.lower().endswith(('.jpg', '.jpeg', '.png')):
                                    try:
                                        os.remove(os.path.join(temp_dir, f))
                                    except Exception:
                                        pass

                            preload_all_notes(pres, pres_name)

                            exported_all = False
                            try:
                                pres.Export(temp_dir, "JPG")
                                exported_all = True
                            except Exception:
                                pass

                            if exported_all:
                                for i in range(1, total_slides + 1):
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
                                for i in range(1, total_slides + 1):
                                    slide = pres.Slides(i)
                                    target_jpg = os.path.join(temp_dir, f"{i}.jpg")
                                    slide.Export(target_jpg, "JPG")
                                    try:
                                        shutil.copyfile(target_jpg, os.path.join(temp_dir, f"Slide{i}.JPG"))
                                    except Exception:
                                        pass

                            update_thumbnails_cache(temp_dir)
                            last_pres_name = pres_name
                            last_slide_pos = None  # Force fresh state emission

                        # If slide position changed or base64 needs refreshing:
                        if cur_pos != last_slide_pos or _bridge_state is None or _bridge_state.get("current_slide_base64") is None:
                            temp_dir = _current_slides_dir
                            cur_base64 = load_slide_base64(temp_dir, cur_pos)
                            next_pos = cur_pos + 1 if cur_pos < total_slides else 0
                            next_base64 = load_slide_base64(temp_dir, next_pos)
                            notes_text = _notes_cache.get((pres_name, cur_pos), "")

                            _bridge_state = {
                                "current_slide": cur_pos,
                                "current_slide_base64": cur_base64,
                                "next_slide": next_pos,
                                "next_slide_base64": next_base64,
                                "total_slides": total_slides,
                                "notes": notes_text.strip()
                            }
                            last_slide_pos = cur_pos
                except Exception:
                    pass

            if not has_slideshow:
                if last_pres_name is not None or _bridge_state is not None:
                    _bridge_state = None
                    last_pres_name = None
                    last_slide_pos = None

        except Exception:
            pass

        time.sleep(0.05)


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


def download_ppt_async(url):
    if not url:
        return
    try:
        temp_dir = tempfile.gettempdir()
        try:
            ctx = ssl.create_default_context(ssl.CERT_NONE)
        except TypeError:
            ctx = ssl.create_default_context()
            ctx.check_hostname = False
            ctx.verify_mode = ssl.CERT_NONE

        filepath = os.path.abspath(os.path.join(temp_dir, f"activedeck_downloaded_{int(time.time())}.pptx"))
        print(f"[ActiveDeck Bridge] Downloading PPT from: {url}")
        try:
            with urllib.request.urlopen(url, context=ctx) as resp, open(filepath, "wb") as out_file:
                out_file.write(resp.read())
        except Exception:
            req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"})
            with urllib.request.urlopen(req, context=ctx) as resp, open(filepath, "wb") as out_file:
                out_file.write(resp.read())

        print(f"[ActiveDeck Bridge] Successfully downloaded ({os.path.getsize(filepath)} bytes) to {filepath}")
        ppt_cmd_queue.put(('open_filepath', filepath))
    except Exception as e:
        import traceback
        err_msg = f"Error in download_ppt_async: {str(e)}\n{traceback.format_exc()}"
        print(f"[ActiveDeck Bridge] {err_msg}")
        with open(os.path.join(tempfile.gettempdir(), "activedeck_error.log"), "w") as f:
            f.write(err_msg)


# ---------------------------------------------------------
# HTTP & WEBSOCKET ROUTES (100% COM-Free)
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
    global _bridge_state
    return jsonify(_bridge_state or {})


@app.route('/load', methods=['POST', 'GET', 'OPTIONS'])
def handle_load_http():
    if request.method == 'POST':
        data = request.get_json(silent=True) or {}
        url = data.get('url') or request.args.get('url')
    else:
        url = request.args.get('url')
    if url:
        threading.Thread(target=download_ppt_async, args=(url,), daemon=True).start()
        return jsonify({'status': 'success', 'message': 'Presentation loading initiated'})
    return jsonify({'status': 'error', 'message': 'Missing URL'}), 400


@app.route('/slides/<path:filename>')
def serve_slide(filename):
    global _current_slides_dir
    temp_dir = _current_slides_dir
    if not os.path.exists(temp_dir) or not os.listdir(temp_dir):
        # Fallback to any recent activedeck_slides_* folder on disk
        t_base = tempfile.gettempdir()
        try:
            dirs = [os.path.join(t_base, d) for d in os.listdir(t_base) if d.startswith("activedeck_slides_")]
            if dirs:
                dirs.sort(key=lambda p: os.path.getmtime(p), reverse=True)
                temp_dir = dirs[0]
        except Exception:
            pass

    os.makedirs(temp_dir, exist_ok=True)
    target = os.path.join(temp_dir, filename)
    if not os.path.exists(target):
        base, ext = os.path.splitext(filename)
        candidates = [f"Slide{base}.JPG", f"Slide{base}.jpg", f"{base}.JPG", f"{base}.jpeg", f"slide{base}.jpg"]
        for c in candidates:
            if os.path.exists(os.path.join(temp_dir, c)):
                filename = c
                break

    if not os.path.exists(os.path.join(temp_dir, filename)):
        return jsonify({'error': 'Slide image not ready yet'}), 404

    response = make_response(send_from_directory(temp_dir, filename))
    response.headers['Cache-Control'] = 'no-cache, no-store, must-revalidate, max-age=0'
    response.headers['Pragma'] = 'no-cache'
    response.headers['Expires'] = '0'
    return response


@app.route('/export', methods=['GET', 'POST', 'OPTIONS'])
def handle_export_route():
    global _current_slides_dir
    temp_dir = _current_slides_dir
    count = 0
    if os.path.exists(temp_dir):
        count = len([f for f in os.listdir(temp_dir) if f.lower().endswith(('.jpg', '.jpeg')) and not f.lower().startswith('slide')])
    return jsonify({'success': True, 'count': count})


@app.route('/<direction>', methods=['GET', 'POST', 'OPTIONS'])
def handle_direction_http(direction):
    if direction not in ['slides', 'ws', 'status', 'load', 'export']:
        ppt_cmd_queue.put(('move', direction))
        return jsonify({'status': 'success', 'direction': direction})
    return jsonify({'status': 'ignored'})


def handle_ws(ws):
    last_state = None
    last_sent_thumbnails_version = 0
    while True:
        force_send = False
        try:
            message = ws.receive(timeout=0.04)
            if message:
                try:
                    payload = json.loads(message)
                    if isinstance(payload, dict):
                        action = payload.get('action')
                        if action == 'move':
                            direction = payload.get('direction', 'next')
                            ppt_cmd_queue.put(('move', direction))
                            force_send = True
                        elif action == 'load':
                            url = payload.get('url')
                            if url:
                                threading.Thread(target=download_ppt_async, args=(url,), daemon=True).start()
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
                        ppt_cmd_queue.put(('move', str(payload)))
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
                        ppt_cmd_queue.put(('move', message))
                        force_send = True
        except Exception:
            pass

        state = _bridge_state

        if state and (state != last_state or force_send):
            try:
                ws.send(json.dumps(state))
                last_state = dict(state)
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


@sock.route('/ws')
def _handle_ws_route(ws):
    handle_ws(ws)


def free_port(port=5000):
    if current_os == "Windows":
        try:
            out = subprocess.check_output(f'netstat -ano | findstr :{port}', shell=True, text=True)
            for line in out.strip().splitlines():
                parts = line.split()
                if len(parts) >= 5 and 'LISTENING' in parts:
                    pid = int(parts[-1])
                    if pid != os.getpid():
                        print(f"[ActiveDeck Bridge] Terminating zombie process {pid} on port {port}...")
                        subprocess.run(f'taskkill /F /PID {pid}', shell=True, capture_output=True)
                        time.sleep(0.5)
        except Exception:
            pass


if __name__ == '__main__':
    free_port(5000)
    worker_thread = threading.Thread(target=ppt_controller_worker, daemon=True)
    worker_thread.start()
    print("=" * 60)
    print("  ActiveDeck Bridge v3.1 (Single-Threaded COM Architecture)")
    print("  Local Server: http://127.0.0.1:5000")
    print("  WebSocket:    ws://127.0.0.1:5000/ws")
    print("  PowerPoint:   Dedicated Controller Active")
    print("  Keep this window open while presenting.")
    print("=" * 60)
    app.run(host='127.0.0.1', port=5000)