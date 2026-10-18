Set shell = CreateObject("WScript.Shell")
shell.Run "powershell.exe -NoProfile -STA -ExecutionPolicy Bypass -File """ & Replace(WScript.ScriptFullName, "install-friday-gui.vbs", "install-friday-gui.ps1") & """", 0, False
