@echo off
rem Start ActiveDeck Bridge in the background with no console window
if exist "%~dp0activedeck_bridge.exe" (
    start "" "%~dp0activedeck_bridge.exe"
    exit /b 0
)

if exist "%~dp0activedeck_bridge.pyw" (
    start "" pythonw "%~dp0activedeck_bridge.pyw"
    exit /b 0
)

start "" pythonw "%~dp0activedeck_bridge.py"
exit /b 0
