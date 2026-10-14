@echo off
echo Stopping ActiveDeck Bridge background processes...
taskkill /F /IM activedeck_bridge.exe 2>nul
powershell -Command "Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*activedeck_bridge*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }" 2>nul
echo ActiveDeck Bridge stopped.
