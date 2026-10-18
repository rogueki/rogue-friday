$ErrorActionPreference = 'Stop'
$fixture = Join-Path ([IO.Path]::GetTempPath()) ("friday update task " + [guid]::NewGuid().ToString('N'))
$name = 'FRIDAY_Update_Test_' + [guid]::NewGuid().ToString('N')
New-Item -ItemType Directory -Path $fixture | Out-Null
try {
    $script = Join-Path $fixture 'harmless update.ps1'
    $output = Join-Path $fixture 'survived.txt'
    [IO.File]::WriteAllText($script, "Start-Sleep -Seconds 2`n[IO.File]::WriteAllText('$($output.Replace("'", "''"))','survived')`nUnregister-ScheduledTask -TaskName '$name' -Confirm:`$false`n")
    $launcher = Join-Path $fixture 'launcher.ps1'
    [IO.File]::WriteAllText($launcher, @"
`$ErrorActionPreference = 'Stop'
`$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument '-NoProfile -ExecutionPolicy Bypass -File "$script"'
`$principal = New-ScheduledTaskPrincipal -UserId ([Security.Principal.WindowsIdentity]::GetCurrent().Name) -LogonType Interactive -RunLevel Limited
`$settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit (New-TimeSpan -Minutes 5) -Hidden
Register-ScheduledTask -TaskName '$name' -Action `$action -Principal `$principal -Settings `$settings | Out-Null
Start-ScheduledTask -TaskName '$name'
"@)
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $launcher
    if ($LASTEXITCODE -ne 0) { throw 'Getrennter Launcher konnte die Aufgabe nicht starten.' }
    if (Test-Path -LiteralPath $output) { throw 'Testskript lief vor dem Ende des Launchers.' }
    $deadline = (Get-Date).AddSeconds(12)
    while (-not (Test-Path -LiteralPath $output) -and (Get-Date) -lt $deadline) { Start-Sleep -Milliseconds 100 }
    if (-not (Test-Path -LiteralPath $output) -or (Get-Content -LiteralPath $output -Raw) -cne 'survived') {
        throw 'Geplante Update-Testaufgabe hat das harmlose Skript nicht ausgefuehrt.'
    }
    $deadline = (Get-Date).AddSeconds(3)
    while ((Get-ScheduledTask -TaskName $name -ErrorAction SilentlyContinue) -and (Get-Date) -lt $deadline) { Start-Sleep -Milliseconds 100 }
    if (Get-ScheduledTask -TaskName $name -ErrorAction SilentlyContinue) { throw 'Update-Testaufgabe hat sich nicht selbst entfernt.' }
    Write-Output 'Dashboard-Update-Task-Launcher: PASS'
} finally {
    Unregister-ScheduledTask -TaskName $name -Confirm:$false -ErrorAction SilentlyContinue
    $resolvedFixture = [IO.Path]::GetFullPath($fixture)
    $tempRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath())
    if (-not $resolvedFixture.StartsWith($tempRoot, [StringComparison]::OrdinalIgnoreCase)) { throw 'Unsicherer Testpfad.' }
    Remove-Item -LiteralPath $fixture -Recurse -Force
}
