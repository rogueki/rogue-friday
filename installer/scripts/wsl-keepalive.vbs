' Haelt WSL dauerhaft wach (sonst faehrt WSL ohne offene Sitzung herunter und Hermes ist weg).
Set wmi = GetObject("winmgmts:\\.\root\cimv2")
Set running = wmi.ExecQuery("SELECT ProcessId FROM Win32_Process WHERE Name='wsl.exe' AND CommandLine LIKE '%-d Ubuntu --exec /bin/sleep infinity%'")
If running.Count = 0 Then
    CreateObject("WScript.Shell").Run "wsl.exe -d Ubuntu --exec /bin/sleep infinity", 0, False
End If
