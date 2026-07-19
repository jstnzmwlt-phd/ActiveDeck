import platform
import sys
import json
import time
import os
import tempfile
import threading
import base64

current_os = platform.system()

if current_os == "Windows":
    import win32com.client
    import pythoncom
elif current_os == "Darwin":
    import subprocess

from flask import Flask, send_from_directory, make_response
from flask_sock import Sock

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
            if direction == "next":
                view.Next()
            else:
                view.Previous()
    except Exception:
        pass
    finally:
        pythoncom.CoUninitialize()

def move_ppt_mac(direction):
    script = 'tell application "Microsoft PowerPoint" to go to next slide slide show view of slide show window 1' if direction == "next" else 'tell application "Microsoft PowerPoint" to go to previous slide slide show view of slide show window 1'
    try:
        subprocess.run(["osascript", "-e", script], capture_output=True, text=True, check=True)
    except Exception:
        pass

def move_ppt_silently(direction):
    if current_os == "Windows":
        move_ppt_windows(direction)
    elif current_os == "Darwin":
        move_ppt_mac(direction)

# ---------------------------------------------------------
# 2. STATE EXTRACTION COMMANDS 
# ---------------------------------------------------------
def get_ppt_state_windows():
    pythoncom.CoInitialize()
    try:
        ppt_app = win32com.client.GetActiveObject("PowerPoint.Application")
        if ppt_app.SlideShowWindows.Count > 0:
            presentation = ppt_app.SlideShowWindows(1).Presentation
            view = ppt_app.SlideShowWindows(1).View
            
            current_slide_index = view.CurrentShowPosition
            total_slides = presentation.Slides.Count
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
                            
            return {
                "current_slide": current_slide_index,
                "next_slide": next_slide_index if next_slide_index > 0 else 0,
                "total_slides": total_slides,
                "notes": notes_text.strip(),
                "next_slide_base64": next_slide_base64
            }
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
                        os.makedirs(temp_dir, exist_ok=True)
                        
                        # EXPORT BOTH FORMATS: 
                        # We save slide as both '{i}.jpg' (for frontend requests) and 'Slide{i}.JPG' (legacy backup)
                        # This fixes the filename casing and prefix mismatch perfectly!
                        for i in range(1, pres.Slides.Count + 1):
                            slide = pres.Slides(i)
                            slide.Export(os.path.join(temp_dir, f"{i}.jpg"), "JPG")
                            slide.Export(os.path.join(temp_dir, f"Slide{i}.JPG"), "JPG")
                            
                        last_exported_presentation = pres.Name
                else:
                    last_exported_presentation = ""
            except Exception:
                pass
            finally:
                pythoncom.CoUninitialize()

# ---------------------------------------------------------
# 4. WEBSERVER ROUTES (Images & WebSockets)
# ---------------------------------------------------------
@app.route('/slides/<path:filename>')
def serve_slide(filename):
    temp_dir = os.path.join(tempfile.gettempdir(), "activedeck_slides")
    response = make_response(send_from_directory(temp_dir, filename))
    response.headers['Access-Control-Allow-Origin'] = '*'
    return response

@sock.route('/ws')
def handle_ws(ws):
    last_state = None
    while True:
        try:
            message = ws.receive(timeout=0.5)
            if message in ['next', 'prev']:
                move_ppt_silently(message)
        except Exception:
            pass

        state = get_ppt_state_silently()

        if state and state != last_state:
            try:
                ws.send(json.dumps(state))
                last_state = state
            except Exception:
                break

if __name__ == '__main__':
    exporter_thread = threading.Thread(target=background_slide_exporter, daemon=True)
    exporter_thread.start()
    app.run(host='127.0.0.1', port=5000)