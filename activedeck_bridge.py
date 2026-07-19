import platform
import sys
import os
import tempfile
import threading
import time
import json

current_os = platform.system()

# Conditional imports based on Operating System
if current_os == "Windows":
    import win32com.client
    import pythoncom
elif current_os == "Darwin": # macOS
    import subprocess

from flask import Flask, send_from_directory, jsonify
from flask_sock import Sock

app = Flask(__name__)
sock = Sock(app)

EXPORT_DIR = os.path.join(tempfile.gettempdir(), "activedeck_slides")

if not os.path.exists(EXPORT_DIR):
    os.makedirs(EXPORT_DIR)

connected_websockets = set()

# Manually add CORS support to avoid extra library dependencies
@app.after_request
def add_cors_headers(response):
    response.headers['Access-Control-Allow-Origin'] = '*'
    response.headers['Access-Control-Allow-Headers'] = 'Content-Type'
    response.headers['Access-Control-Allow-Methods'] = 'GET, POST, OPTIONS'
    return response

def move_ppt_windows(direction):
    pythoncom.CoInitialize()
    try:
        # Get the running PowerPoint Application
        ppt_app = win32com.client.GetActiveObject("PowerPoint.Application")
        
        # Check if a presentation is actually running in Slide Show mode (F5)
        if ppt_app.SlideShowWindows.Count > 0:
            view = ppt_app.SlideShowWindows(1).View
            if direction == "next":
                view.Next()
            else:
                view.Previous()
            print(f"Success: Slide moved {direction}")
        else:
            print("Error: No active Slide Show (F5) found.")
            
    except Exception as e:
        print(f"Connection Error: {e}. Is PowerPoint open?")
    finally:
        # Clean up the communication line
        pythoncom.CoUninitialize()

def move_ppt_mac(direction):
    script = ""
    if direction == "next":
        script = 'tell application "Microsoft PowerPoint" to go to next slide slide show view of slide show window 1'
    elif direction == "prev":
        script = 'tell application "Microsoft PowerPoint" to go to previous slide slide show view of slide show window 1'
    
    try:
        # Run AppleScript silently via osascript
        subprocess.run(["osascript", "-e", script], capture_output=True, text=True, check=True)
        print(f"Success: Slide moved {direction}")
    except subprocess.CalledProcessError as e:
        print(f"Error: Could not control PowerPoint. Ensure a PowerPoint Slide Show is running. Details: {e.stderr.strip()}")
    except Exception as e:
        print(f"Unexpected error: {e}")

def move_ppt_silently(direction):
    if current_os == "Windows":
        move_ppt_windows(direction)
    elif current_os == "Darwin":
        move_ppt_mac(direction)
    else:
        print(f"Unsupported OS: {current_os}")

def export_ppt_slides_windows():
    pythoncom.CoInitialize()
    try:
        ppt_app = win32com.client.GetActiveObject("PowerPoint.Application")
        presentation = None
        if ppt_app.SlideShowWindows.Count > 0:
            presentation = ppt_app.SlideShowWindows(1).Presentation
        elif ppt_app.Presentations.Count > 0:
            presentation = ppt_app.ActivePresentation
            
        if presentation is not None:
            print(f"Exporting {presentation.Slides.Count} slides to {EXPORT_DIR}...")
            
            # Clear old slides first to prevent showing stale slides
            for f in os.listdir(EXPORT_DIR):
                if f.endswith('.jpg'):
                    try:
                        os.remove(os.path.join(EXPORT_DIR, f))
                    except:
                        pass

            for i, slide in enumerate(presentation.Slides, start=1):
                image_path = os.path.join(EXPORT_DIR, f"{i}.jpg")
                slide.Export(image_path, "JPG", 1024, 576)
            print(f"Successfully exported {presentation.Slides.Count} slides.")
            return presentation.Slides.Count
        else:
            print("No active presentation found to export.")
            return 0
    except Exception as e:
        print(f"Error exporting slides: {e}")
        return 0
    finally:
        pythoncom.CoUninitialize()

def export_slides_silently():
    if current_os == "Windows":
        return export_ppt_slides_windows()
    else:
        print(f"Export not implemented for OS: {current_os}")
        return 0

def track_ppt_slideshow():
    # Maintain a reference to previous slide states to detect transitions
    prev_slide = None
    prev_total = None
    prev_notes = None
    prev_next_slide_base64 = None
    
    while True:
        time.sleep(0.3) # Poll PowerPoint slideshow state every 300ms
        if not connected_websockets:
            continue
            
        pythoncom.CoInitialize()
        try:
            ppt_app = win32com.client.GetActiveObject("PowerPoint.Application")
            if ppt_app.SlideShowWindows.Count > 0:
                ss_window = ppt_app.SlideShowWindows(1)
                view = ss_window.View
                current_slide_num = view.CurrentShowPosition
                presentation = ss_window.Presentation
                total_slides = presentation.Slides.Count
                
                # Extract notes for current slide
                current_slide = presentation.Slides(current_slide_num)
                notes_text = ""
                if current_slide.HasNotesPage:
                    notes_page = current_slide.NotesPage
                    for shape in notes_page.Shapes:
                        if shape.Type == 14: # ppPlaceholderBody / Body placeholder
                            if shape.TextFrame.HasText:
                                paragraphs = []
                                for para in shape.TextFrame.TextRange.Paragraphs():
                                    text = para.Text
                                    # Strip trailing carriage returns standard to PowerPoint text blocks
                                    clean_text = text.rstrip('\r\n')
                                    bullet_type = para.Format.Bullet.Type
                                    if bullet_type != 0 and clean_text: # ppBulletNone is 0
                                        paragraphs.append(f"• {clean_text}")
                                    else:
                                        paragraphs.append(clean_text)
                                # Join with newline to maintain PowerPoint text spacing flawlessly!
                                notes_text = "\n".join(paragraphs).strip()
                                break
                
                next_slide_num = current_slide_num + 1 if current_slide_num < total_slides else None
                
                # Fetch next slide image as base64 securely if it exists
                next_slide_base64 = None
                if next_slide_num is not None:
                    next_image_path = os.path.join(EXPORT_DIR, f"{next_slide_num}.jpg")
                    if os.path.exists(next_image_path):
                        try:
                            with open(next_image_path, "rb") as img_file:
                                import base64
                                next_slide_base64 = "data:image/jpeg;base64," + base64.b64encode(img_file.read()).decode('utf-8')
                        except Exception:
                            pass
                
                # Broadcast payload if presentation state has changed
                if (current_slide_num != prev_slide or 
                    total_slides != prev_total or 
                    notes_text != prev_notes or
                    next_slide_base64 != prev_next_slide_base64):
                    
                    # Automatically trigger background slide export when a slideshow starts or slide count changes
                    if total_slides != prev_total:
                        try:
                            threading.Thread(target=export_slides_silently, daemon=True).start()
                        except Exception as thread_err:
                            print(f"Failed to launch background auto-export: {thread_err}")

                    prev_slide = current_slide_num
                    prev_total = total_slides
                    prev_notes = notes_text
                    prev_next_slide_base64 = next_slide_base64
                    
                    payload = {
                        "current_slide": current_slide_num,
                        "next_slide": next_slide_num if next_slide_num is not None else 0,
                        "total_slides": total_slides,
                        "notes": notes_text,
                        "next_slide_base64": next_slide_base64
                    }
                    
                    message_str = json.dumps(payload)
                    print(f"Broadcasting slide update: Slide {current_slide_num} of {total_slides}")
                    
                    for ws in list(connected_websockets):
                        try:
                            ws.send(message_str)
                        except Exception as ws_err:
                            connected_websockets.discard(ws)
            else:
                pass
        except Exception as e:
            # PPT closed or not in active slideshow, ignore silently
            pass
        finally:
            pythoncom.CoUninitialize()

@app.route('/slides/<path:filename>')
def serve_slide(filename):
    return send_from_directory(EXPORT_DIR, filename)

@app.route('/export')
def trigger_export():
    count = export_slides_silently()
    return jsonify({"success": True, "count": count})

@sock.route('/ws')
def handle_ws(ws):
    print("New WebSocket connection established.")
    connected_websockets.add(ws)
    
    # Try to export slides automatically when client connects
    try:
        export_slides_silently()
    except Exception as e:
        print(f"Auto-export on WS connect failed: {e}")

    try:
        while True:
            message = ws.receive()
            if message in ['next', 'prev']:
                move_ppt_silently(message)
    except Exception as e:
        print(f"WebSocket connection closed: {e}")
    finally:
        connected_websockets.discard(ws)

if __name__ == '__main__':
    print(f"ActiveDeck Bridge starting on system: {current_os}")
    
    # Start background slideshow tracking thread
    if current_os == "Windows":
        tracker_thread = threading.Thread(target=track_ppt_slideshow, daemon=True)
        tracker_thread.start()
        print("PowerPoint slideshow tracking thread started.")
        
    # host='127.0.0.1' allows the bridge to listen to the local WebSocket
    app.run(host='127.0.0.1', port=5000)