Set shell = CreateObject("WScript.Shell")
gui = Replace(WScript.ScriptFullName, "install-friday-gui.vbs", "install-friday-gui.ps1")
extra = ""
i = 0
Do While i < WScript.Arguments.Count
    name = WScript.Arguments(i)
    If (name = "-ResumeRoot" Or name = "-Simulation") And i + 1 < WScript.Arguments.Count Then
        value = WScript.Arguments(i + 1)
        If name = "-ResumeRoot" Then
            extra = extra & " -ResumeRoot " & Chr(34) & value & Chr(34)
        Else
            extra = extra & " -Simulation " & value
        End If
        i = i + 1
    End If
    i = i + 1
Loop
shell.Run "powershell.exe -NoProfile -STA -ExecutionPolicy Bypass -File " & Chr(34) & gui & Chr(34) & extra, 0, False
