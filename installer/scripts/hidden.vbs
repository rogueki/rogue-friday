' Startet ein PowerShell-Skript unsichtbar (fuer Autostart-Aufgaben). Aufruf: wscript hidden.vbs <skript.ps1>
Set args = WScript.Arguments
CreateObject("WScript.Shell").Run "powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File """ & args(0) & """", 0, False
