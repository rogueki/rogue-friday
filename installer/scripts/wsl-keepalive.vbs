' Haelt die konfigurierte WSL-Distribution dauerhaft wach.
Set args = WScript.Arguments
distro = "Ubuntu"
If args.Count > 0 Then distro = args(0)
Set validName = New RegExp
validName.Pattern = "^[A-Za-z][A-Za-z0-9_-]{0,31}$"
If Not validName.Test(distro) Then WScript.Quit 1
Set wmi = GetObject("winmgmts:\\.\root\cimv2")
Set running = wmi.ExecQuery("SELECT ProcessId FROM Win32_Process WHERE Name='wsl.exe' AND CommandLine LIKE '%-d " & distro & " --exec /bin/sleep infinity%'")
If running.Count = 0 Then
    CreateObject("WScript.Shell").Run "wsl.exe -d " & distro & " --exec /bin/sleep infinity", 0, False
End If
