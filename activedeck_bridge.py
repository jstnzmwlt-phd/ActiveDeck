import platform
import sys
import json
import time
import os
import tempfile
import threading
import base64
import urllib.request
import urllib.parse

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
        global _cached_state, _cached_slide_index, _cached_total_slides
        _cached_state = None
        _cached_slide_index = None
        _cached_total_slides = None
        slides_dir = os.path.join(tempfile.gettempdir(), "activedeck_slides")
        if os.path.exists(slides_dir):
            for f in os.listdir(slides_dir):
                if f.lower().endswith(('.jpg', '.jpeg', '.png')):
                    try:
                        os.remove(os.path.join(slides_dir, f))
                    except Exception:
                        pass

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
            finally:
                pythoncom.CoUninitialize()
    except Exception as e:
        print(f"Error in download_and_open_ppt: {e}")


# ---------------------------------------------------------
# 2. STATE EXTRACTION COMMANDS 
# ---------------------------------------------------------
_cached_state = None
_cached_slide_index = None
_cached_total_slides = None

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
            
            current_slide = presentation.Slides(current_slide_index)
            notes_text = ""
            
            if current_slide.HasNotesPage:
                notes_page = current_slide.NotesPage
                for shape in notes_page.Shapes:
                    if shape.Type == 14 and shape.PlaceholderFormat.Type == 2: 
                        if shape.HasTextFrame and shape.TextFrame.HasText:
                            notes_text = shape.TextFrame.TextRange.Text
                            break
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
    last_exported_presentation = ""
    temp_dir = os.path.join(tempfile.gettempdir(), "activedeck_slides")
    
    while True:
        time.sleep(2)
        if current_os == "Windows":
            try:
                pythoncom.CoInitialize()
                ppt_app = win32com.client.GetActiveObject("PowerPoint.Application")
                
                if ppt_app.SlideShowWindows.Count > 0:
                    pres = ppt_app.SlideShowWindows(1).Presentation
                    
                    if pres.Name != last_exported_presentation:
                        global _cached_state, _cached_slide_index, _cached_total_slides
                        _cached_state = None
                        _cached_slide_index = None
                        _cached_total_slides = None
                        os.makedirs(temp_dir, exist_ok=True)
                        for f in os.listdir(temp_dir):
                            if f.lower().endswith(('.jpg', '.jpeg', '.png')):
                                try:
                                    os.remove(os.path.join(temp_dir, f))
                                except Exception:
                                    pass
                        count = pres.Slides.Count
                        for i in range(1, count + 1):
                            slide = pres.Slides(i)
                            target_jpg = os.path.join(temp_dir, f"{i}.jpg")
                            slide.Export(target_jpg, "JPG")
                            try:
                                import shutil
                                shutil.copyfile(target_jpg, os.path.join(temp_dir, f"Slide{i}.JPG"))
                            except Exception:
                                pass
                            time.sleep(0.01)  # Yield COM STA thread so navigation calls execute instantly!
                            
                        last_exported_presentation = pres.Name
                else:
                    last_exported_presentation = ""
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
        download_and_open_ppt(url)
        return jsonify({'status': 'success', 'message': 'Presentation loaded'})
    return jsonify({'status': 'error', 'message': 'Missing URL'}), 400

@app.route('/slides/<path:filename>')
def serve_slide(filename):
    temp_dir = os.path.join(tempfile.gettempdir(), "activedeck_slides")
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
                for i in range(1, count + 1):
                    slide = pres.Slides(i)
                    target_jpg = os.path.join(temp_dir, f"{i}.jpg")
                    slide.Export(target_jpg, "JPG")
                    try:
                        import shutil
                        shutil.copyfile(target_jpg, os.path.join(temp_dir, f"Slide{i}.JPG"))
                    except Exception:
                        pass
                    time.sleep(0.01)
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
                                download_and_open_ppt(url)
                                force_send = True
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

if __name__ == '__main__':
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