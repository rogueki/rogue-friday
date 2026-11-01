$ErrorActionPreference = 'Stop'
# Regression: the WSL step read $LASTEXITCODE after Invoke-CapturedProcess, which does not set it. robocopy's 1
# ("files copied") from step 2 then looked like "WSL missing" and every run asked for another Windows restart.
function Assert-True([bool]$Condition, [string]$Message) { if (-not $Condition) { throw $Message } }
$installerDir = Split-Path $PSScriptRoot -Parent
. (Join-Path $installerDir 'lib\process-supervisor.ps1')

# --- 1. The trap itself: a captured process leaves $LASTEXITCODE untouched, its exit code is in the result.
& cmd.exe /d /c exit 1
Assert-True ($LASTEXITCODE -eq 1) 'Vorbedingung: cmd.exe /c exit 1 setzt LASTEXITCODE nicht.'
$run = Invoke-CapturedProcess -FilePath 'cmd.exe' -Arguments @('/d', '/c', 'exit 0') -TimeoutSeconds 30
Assert-True ($run.ExitCode -eq 0) "Invoke-CapturedProcess liefert den Exitcode nicht im Ergebnis: $($run.ExitCode)"
Assert-True ($LASTEXITCODE -eq 1) 'Invoke-CapturedProcess setzt LASTEXITCODE inzwischen; dann ist dieser Test zu überarbeiten.'

# --- 2. No caller reads $LASTEXITCODE after a captured process.
$tokens = $null; $errors = $null
foreach ($file in @(Get-ChildItem -LiteralPath $installerDir -Filter '*.ps1') + @(Get-ChildItem -LiteralPath (Join-Path $installerDir 'scripts') -Filter '*.ps1')) {
    $lines = [IO.File]::ReadAllLines($file.FullName)
    for ($i = 0; $i -lt $lines.Count; $i++) {
        if ($lines[$i] -notmatch 'Invoke-CapturedProcess\s' -or $lines[$i] -match '^\s*(function |#)') { continue }
        $window = (@($lines[$i..([Math]::Min($i + 2, $lines.Count - 1))] | Where-Object { $_ -notmatch '^\s*#' }) -join "`n")
        Assert-True ($window -notmatch '\$LASTEXITCODE') "$($file.Name):$($i + 1) liest LASTEXITCODE nach Invoke-CapturedProcess."
    }
}

# --- 3. The WSL step uses the result and never asks for a second restart.
$installer = [IO.File]::ReadAllText((Join-Path $installerDir 'install-friday.ps1'))
Assert-True ($installer -match "\`$statusRun = Invoke-CapturedProcess -FilePath 'wsl\.exe' -Arguments @\('--status'\)") 'Der WSL-Schritt behält das Ergebnis von wsl --status nicht.'
Assert-True ($installer -match '\$wslReady = \$statusRun\.ExitCode -eq 0') 'Der WSL-Schritt prüft nicht den Exitcode von wsl --status.'
# No distribution yet (Ubuntu follows in step 7): 'wsl --version' must count as installed WSL.
Assert-True ($installer -match "if \(-not \`$wslReady\) \{ \`$wslReady = \(Invoke-CapturedProcess -FilePath 'wsl\.exe' -Arguments @\('--version'\)[^\r\n]*\.ExitCode -eq 0 \}") 'Ohne Distribution gilt eine installierte WSL nicht als bereit.'
Assert-True ($installer -match 'if \(-not \$wslReady\) \{\r?\n\s+\$rebootRequestedAt') 'Neuinstallation von WSL hängt nicht an der Bereitschaftsprüfung.'
Assert-True ($installer -match "\`$State\['wsl_reboot_requested_at'\] = \(Get-Date\)[^\r\n]*\r?\n\s+Save-State\r?\n\s+Warn 'Windows muss jetzt neu starten") 'Die Neustart-Anforderung wird nicht vor dem Neustart gespeichert.'
Assert-True ($installer -match '-lt \$lastBoot\) \{') 'Nach einem Neustart wird nicht erkannt, dass WSL schon eingerichtet wurde.'
foreach ($text in @('im BIOS/UEFI ausgeschaltet', 'folgende Windows-Funktionen fehlen', 'WSL antwortet auch nach dem Neustart nicht')) {
    Assert-True ($installer.Contains($text)) "Die Diagnose nach dem Neustart fehlt: $text"
}
$guard = $installer.IndexOf('-lt $lastBoot) {'); $install = $installer.IndexOf("Info 'WSL wird installiert")
Assert-True ($guard -gt 0 -and $guard -lt $install) 'Die Diagnose nach dem Neustart steht nicht vor der erneuten WSL-Installation.'
Write-Output 'WSL-Neustartschleife: PASS'
