import platform
import sys

current_os = platform.system()

# Conditional imports based on Operating System
if current_os == "Windows":
    import win32com.client
    import pythoncom
elif current_os == "Darwin": # macOS
    import subprocess

from flask import Flask
from flask_sock import Sock

app = Flask(__name__)
sock = Sock(app)

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

@sock.route('/ws')
def handle_ws(ws):
    while True:
        message = ws.receive()
        if message in ['next', 'prev']:
            move_ppt_silently(message)

if __name__ == '__main__':
    print(f"ActiveDeck Bridge starting on system: {current_os}")
    # host='127.0.0.1' allows the bridge to listen to the local WebSocket
    app.run(host='127.0.0.1', port=5000)