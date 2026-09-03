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

# Global COM Lock to prevent PowerPoint STA thread collisions between exporter & commands
com_lock = threading.Lock()

# ---------------------------------------------------------
# 1. MOVEMENT COMMANDS
# ---------------------------------------------------------
def move_ppt_windows(direction):
    with com_lock:
        pythoncom.CoInitialize()
        try:
            ppt_app = win32com.client.GetActiveObject("PowerPoint.Application")
            
            # Scenario A: PowerPoint is running in Slide Show Mode
            if ppt_app.SlideShowWindows.Count > 0:
                view = ppt_app.SlideShowWindows(1).View
                presentation = ppt_app.SlideShowWindows(1).Presentation
                total_slides = presentation.Slides.Count
                current_pos = view.CurrentShowPosition

            if direction == "next":
                # CRITICAL GUARD: In PowerPoint COM API, calling view.Next() on the last slide
                # terminates the slideshow and returns PowerPoint to Normal Editing View.
                # Only advance if we are not already on the last slide.
                if current_pos < total_slides:
                    view.Next()
            elif direction == "prev":
                if current_pos > 1:
                    view.Previous()
            else:
                try:
                    slide_num = int(direction)
                    if 1 <= slide_num <= total_slides:
                        view.GotoSlide(slide_num)
                except ValueError:
                    pass

        # Scenario B: PowerPoint is in Normal Editing View
        elif ppt_app.Presentations.Count > 0:
            pres = ppt_app.ActivePresentation
            if pres:
                try:
                    win = ppt_app.ActiveWindow
                    total_slides = pres.Slides.Count
                    current_pos = win.View.Slide.SlideIndex if (win and win.View and win.View.Slide) else 1
                    
                    if direction == "next":
                        if current_pos < total_slides:
                            win.View.GotoSlide(current_pos + 1)
                    elif direction == "prev":
                        if current_pos > 1:
                            win.View.GotoSlide(current_pos - 1)
                    else:
                        try:
                            slide_num = int(direction)
                            if 1 <= slide_num <= total_slides:
                                win.View.GotoSlide(slide_num)
                        except ValueError:
                            pass
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

# ---------------------------------------------------------
# 2. STATE EXTRACTION COMMANDS 
# ---------------------------------------------------------
def get_ppt_state_windows():
    with com_lock:
        pythoncom.CoInitialize()
        try:
            ppt_app = win32com.client.GetActiveObject("PowerPoint.Application")
            
            current_slide_index = None
            total_slides = 0
            presentation = None
            
            # Primary: Active Slide Show Window
            if ppt_app.SlideShowWindows.Count > 0:
                presentation = ppt_app.SlideShowWindows(1).Presentation
                view = ppt_app.SlideShowWindows(1).View
                current_slide_index = view.CurrentShowPosition
                total_slides = presentation.Slides.Count
            # Secondary Fallback: Normal View (if presenter is viewing/editing slides in Normal View)
            elif ppt_app.Presentations.Count > 0:
                presentation = ppt_app.ActivePresentation
                total_slides = presentation.Slides.Count
                try:
                    win = ppt_app.ActiveWindow
                    if win and win.View and win.View.Slide:
                        current_slide_index = win.View.Slide.SlideIndex
                except Exception:
                    current_slide_index = 1

            if presentation and current_slide_index is not None and total_slides > 0:
                next_slide_index = current_slide_index + 1 if current_slide_index < total_slides else 0
                
                notes_text = ""
                try:
                    current_slide = presentation.Slides(current_slide_index)
                    if current_slide.HasNotesPage:
                        notes_page = current_slide.NotesPage
                        for shape in notes_page.Shapes:
                            if shape.Type == 14 and shape.PlaceholderFormat.Type == 2: 
                                if shape.HasTextFrame and shape.TextFrame.HasText:
                                    notes_text = shape.TextFrame.TextRange.Text
                                    break
                except Exception:
                    pass

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
                                
                return {
                    "current_slide": current_slide_index,
                    "current_slide_base64": current_slide_base64,
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
            with com_lock:
                try:
                    pythoncom.CoInitialize()
                    ppt_app = win32com.client.GetActiveObject("PowerPoint.Application")
                    
                    pres = None
                    if ppt_app.SlideShowWindows.Count > 0:
                        pres = ppt_app.SlideShowWindows(1).Presentation
                    elif ppt_app.Presentations.Count > 0:
                        pres = ppt_app.ActivePresentation
                    
                    if pres and pres.Name != last_exported_presentation:
                        # Clear old slides in temp_dir to prevent serving stale files from previous presentations
                        try:
                            import shutil
                            if os.path.exists(temp_dir):
                                shutil.rmtree(temp_dir)
                        except Exception:
                            pass
                        os.makedirs(temp_dir, exist_ok=True)
                        
                        # EXPORT BOTH FORMATS: 
                        # We save slide as both '{i}.jpg' (for frontend requests) and 'Slide{i}.JPG' (legacy backup)
                        # This fixes the filename casing and prefix mismatch perfectly!
                        for i in range(1, pres.Slides.Count + 1):
                            slide = pres.Slides(i)
                            slide.Export(os.path.join(temp_dir, f"{i}.jpg"), "JPG")
                            slide.Export(os.path.join(temp_dir, f"Slide{i}.JPG"), "JPG")
                            
                        last_exported_presentation = pres.Name
                    elif not pres:
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

@app.route('/export')
def export_slides_endpoint():
    count = 0
    if current_os == "Windows":
        try:
            pythoncom.CoInitialize()
            ppt_app = win32com.client.GetActiveObject("PowerPoint.Application")
            if ppt_app.SlideShowWindows.Count > 0:
                pres = ppt_app.SlideShowWindows(1).Presentation
                temp_dir = os.path.join(tempfile.gettempdir(), "activedeck_slides")
                # Clear old slides in temp_dir before manual export too
                try:
                    import shutil
                    if os.path.exists(temp_dir):
                        shutil.rmtree(temp_dir)
                except Exception:
                    pass
                os.makedirs(temp_dir, exist_ok=True)
                count = pres.Slides.Count
                for i in range(1, count + 1):
                    slide = pres.Slides(i)
                    slide.Export(os.path.join(temp_dir, f"{i}.jpg"), "JPG")
                    slide.Export(os.path.join(temp_dir, f"Slide{i}.JPG"), "JPG")
        except Exception:
            pass
        finally:
            pythoncom.CoUninitialize()
    response = make_response(json.dumps({"success": True if count > 0 else False, "count": count}))
    response.headers['Content-Type'] = 'application/json'
    response.headers['Access-Control-Allow-Origin'] = '*'
    return response

@app.route('/status')
def status_endpoint():
    state = get_ppt_state_silently() or {}
    response = make_response(json.dumps(state))
    response.headers['Content-Type'] = 'application/json'
    response.headers['Access-Control-Allow-Origin'] = '*'
    return response

@sock.route('/ws')
def handle_ws(ws):
    last_state = None
    while True:
        try:
            message = ws.receive(timeout=0.5)
            if message:
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