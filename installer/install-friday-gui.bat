@echo off
setlocal
REM Grafischer Assistent. Parameter werden durchgereicht: install-friday-gui.bat -ResumeRoot "D:\..." -Simulation success
REM Ohne Durchreichung startete "-ResumeRoot" erneut eine frische Installation am Standardordner.
powershell.exe -NoProfile -STA -ExecutionPolicy Bypass -File "%~dp0install-friday-gui.ps1" %*
