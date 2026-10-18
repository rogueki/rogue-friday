@echo off
setlocal
if not exist "%~dp0Friday installieren.vbs" (
  echo Die Installationsdateien fehlen. Bitte das vollstaendige GitHub-ZIP zuerst mit "Alle extrahieren" entpacken.
  pause
  exit /b 1
)
wscript.exe "%~dp0Friday installieren.vbs"
if errorlevel 1 (
  echo Der grafische Assistent konnte nicht gestartet werden. Bitte Windows Script Host aktivieren oder installer\install-friday-gui.bat verwenden.
  pause
)
