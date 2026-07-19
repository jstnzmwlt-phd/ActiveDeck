import platform
import sys
import os
import tempfile

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
        if ppt_app.Presentations.Count > 0:
            presentation = ppt_app.ActivePresentation
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

@app.route('/slides/<path:filename>')
def serve_slide(filename):
    return send_from_directory(EXPORT_DIR, filename)

@app.route('/export')
def trigger_export():
    count = export_slides_silently()
    return jsonify({"success": True, "count": count})

@sock.route('/ws')
def handle_ws(ws):
    # Try to export slides automatically when client connects
    try:
        export_slides_silently()
    except Exception as e:
        print(f"Auto-export on WS connect failed: {e}")

    while True:
        message = ws.receive()
        if message in ['next', 'prev']:
            move_ppt_silently(message)

if __name__ == '__main__':
    print(f"ActiveDeck Bridge starting on system: {current_os}")
    # host='127.0.0.1' allows the bridge to listen to the local WebSocket
    app.run(host='127.0.0.1', port=5000)