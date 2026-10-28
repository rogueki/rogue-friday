Set fs = CreateObject("Scripting.FileSystemObject")
Set shell = CreateObject("WScript.Shell")
folder = fs.GetParentFolderName(WScript.ScriptFullName)
gui = fs.BuildPath(folder, "installer\install-friday-gui.ps1")
If Not fs.FileExists(gui) Then
    MsgBox "Die Installationsdateien fehlen. Bitte das vollstaendige GitHub-ZIP mit 'Alle extrahieren' entpacken und Friday installieren.bat im Hauptordner starten.", vbExclamation, "F.R.I.D.A.Y. Installation"
    WScript.Quit 1
End If
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
shell.Run "powershell.exe -NoProfile -STA -ExecutionPolicy Bypass -WindowStyle Hidden -File " & Chr(34) & gui & Chr(34) & extra, 0, False
