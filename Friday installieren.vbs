Set fs = CreateObject("Scripting.FileSystemObject")
Set shell = CreateObject("WScript.Shell")
folder = fs.GetParentFolderName(WScript.ScriptFullName)
gui = fs.BuildPath(folder, "installer\install-friday-gui.ps1")
If Not fs.FileExists(gui) Then
    MsgBox "Die Installationsdateien fehlen. Bitte das vollstaendige GitHub-ZIP mit 'Alle extrahieren' entpacken und Friday installieren.bat im Hauptordner starten.", vbExclamation, "F.R.I.D.A.Y. Installation"
    WScript.Quit 1
End If
extra = ""
If WScript.Arguments.Count = 2 Then
    If WScript.Arguments(0) = "-Simulation" Then
        If WScript.Arguments(1) = "success" Or WScript.Arguments(1) = "failure" Or WScript.Arguments(1) = "restart" Then
            extra = " -Simulation " & WScript.Arguments(1)
        End If
    End If
End If
shell.Run "powershell.exe -NoProfile -STA -ExecutionPolicy Bypass -WindowStyle Hidden -File """ & gui & """" & extra, 0, False
