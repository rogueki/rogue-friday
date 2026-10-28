# Launcher: Doppelklick oeffnet die Oberflaeche, Parameter kommen unveraendert an, der Abbruch der
# Windows-Abfrage aendert nichts, und eine Simulation ist ausserhalb des Testmodus nicht moeglich.
$ErrorActionPreference = 'Stop'
$installer = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$repo = (Resolve-Path -LiteralPath (Join-Path $installer '..')).Path

$script:checks = 0
function Assert-True([bool]$Condition, [string]$Message) {
    $script:checks++
    if (-not $Condition) { throw $Message }
}

$probeScript = @'
param([Parameter(ValueFromRemainingArguments = $true)][string[]]$Rest)
$target = $env:LAUNCHER_PROBE
if (-not $target) { exit 9 }
$payload = [ordered]@{ count = @($Rest).Count; values = @($Rest) }
[IO.File]::WriteAllText($target, ($payload | ConvertTo-Json -Compress), (New-Object Text.UTF8Encoding $false))
'@

$work = Join-Path $env:TEMP ('friday-launcher-' + [guid]::NewGuid().ToString('N'))
try {
    # --- 1. CLI-Batch: Parameter mit Leerzeichen, & und Umlaut kommen unveraendert an (echter cmd.exe-Lauf)
    $cliDir = Join-Path $work 'cli'
    New-Item -ItemType Directory -Force -Path $cliDir | Out-Null
    Copy-Item -LiteralPath (Join-Path $installer 'install-friday.bat') -Destination (Join-Path $cliDir 'install-friday.bat')
    [IO.File]::WriteAllText((Join-Path $cliDir 'install-friday.ps1'), $probeScript)
    $cliProbe = Join-Path $work 'cli-args.json'
    $env:LAUNCHER_PROBE = $cliProbe
    # Nicht-ASCII-Ziele kommen ueber die Oberflaeche (WinForms -> ProcessStartInfo), nicht durch cmd.
    $target = 'C:\Temp\Ziel & Partner (Test)'
    & cmd.exe /c ('"' + (Join-Path $cliDir 'install-friday.bat') + '" -Resume -InstallRoot "' + $target + '"') 2>&1 | Out-Null
    Assert-True (Test-Path -LiteralPath $cliProbe) 'Die CLI-Batch hat den Stub nicht erreicht.'
    $cliArgs = Get-Content -LiteralPath $cliProbe -Raw | ConvertFrom-Json
    Assert-True ($cliArgs.count -eq 3) "Die CLI-Batch reichte $($cliArgs.count) statt drei Argumente durch."
    Assert-True (@($cliArgs.values)[0] -eq '-Resume') "Das erste Argument kam als '$(@($cliArgs.values)[0])' an."
    Assert-True (@($cliArgs.values)[1] -eq '-InstallRoot') 'Der Schalter -InstallRoot ging verloren.'
    Assert-True (@($cliArgs.values)[2] -eq $target) "Der Zielordner kam als '$(@($cliArgs.values)[2])' an."

    # --- 2. GUI-Batch: derselbe Weg fuer den grafischen Assistenten
    $guiBatDir = Join-Path $work 'guibat'
    New-Item -ItemType Directory -Force -Path $guiBatDir | Out-Null
    Copy-Item -LiteralPath (Join-Path $installer 'install-friday-gui.bat') -Destination (Join-Path $guiBatDir 'install-friday-gui.bat')
    [IO.File]::WriteAllText((Join-Path $guiBatDir 'install-friday-gui.ps1'), $probeScript)
    $guiBatProbe = Join-Path $work 'guibat-args.json'
    $env:LAUNCHER_PROBE = $guiBatProbe
    & cmd.exe /c ('"' + (Join-Path $guiBatDir 'install-friday-gui.bat') + '" -ResumeRoot "' + $target + '"') 2>&1 | Out-Null
    Assert-True (Test-Path -LiteralPath $guiBatProbe) 'Die GUI-Batch hat den Stub nicht erreicht.'
    $guiBatArgs = Get-Content -LiteralPath $guiBatProbe -Raw | ConvertFrom-Json
    Assert-True ($guiBatArgs.count -eq 2) "Die GUI-Batch reichte $($guiBatArgs.count) statt zwei Argumente durch."
    Assert-True (@($guiBatArgs.values)[1] -eq $target) "Der Fortsetzungsordner kam als '$(@($guiBatArgs.values)[1])' an."

    # --- 3. Wurzel-VBS: bekannter Parameter kommt an, unbekannter nicht (echter cscript-Lauf)
    $vbsDir = Join-Path $work 'vbs'
    New-Item -ItemType Directory -Force -Path (Join-Path $vbsDir 'installer') | Out-Null
    Copy-Item -LiteralPath (Join-Path $repo 'Friday installieren.vbs') -Destination (Join-Path $vbsDir 'Friday installieren.vbs')
    [IO.File]::WriteAllText((Join-Path $vbsDir 'installer\install-friday-gui.ps1'), $probeScript)
    $vbsProbe = Join-Path $work 'vbs-args.json'
    $env:LAUNCHER_PROBE = $vbsProbe
    & cscript.exe //nologo (Join-Path $vbsDir 'Friday installieren.vbs') -ResumeRoot $target -Simulation success -Bogus 7 2>&1 | Out-Null
    $deadline = (Get-Date).AddSeconds(25)
    while (-not (Test-Path -LiteralPath $vbsProbe) -and (Get-Date) -lt $deadline) { Start-Sleep -Milliseconds 250 }
    Assert-True (Test-Path -LiteralPath $vbsProbe) 'Das Wurzel-VBS hat den Assistenten nicht gestartet.'
    $vbsArgs = @((Get-Content -LiteralPath $vbsProbe -Raw | ConvertFrom-Json).values)
    Assert-True ($vbsArgs -contains '-ResumeRoot') 'Der Fortsetzungsordner wurde nicht durchgereicht.'
    Assert-True ($vbsArgs -contains $target) "Der Fortsetzungsordner kam als '$($vbsArgs -join ' | ')' an."
    Assert-True ($vbsArgs -contains '-Simulation' -and $vbsArgs -contains 'success') 'Der Testmodus wurde nicht durchgereicht.'
    Assert-True (-not ($vbsArgs -contains '-Bogus') -and -not ($vbsArgs -contains '7')) 'Ein unbekannter Parameter wurde weitergegeben.'

    # --- 4. UAC-Abbruch aendert nichts (echter Win32-Fehlercode 1223)
    . (Join-Path $installer 'lib\elevation.ps1')
    $marker = Join-Path $work 'unveraendert'
    New-Item -ItemType Directory -Force -Path $marker | Out-Null
    [IO.File]::WriteAllText((Join-Path $marker 'datei.txt'), 'vorher')
    $before = (@(Get-ChildItem -LiteralPath $marker -Recurse -File | ForEach-Object { $_.FullName + ':' + (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash }) -join ';')
    function Start-Process {
        param($FilePath, $ArgumentList, $Verb, $ErrorAction)
        throw (New-Object System.ComponentModel.Win32Exception 1223)
    }
    $canceled = Start-ElevatedPowerShell -ScriptPath (Join-Path $installer 'install-friday-gui.ps1') -ForwardedArguments @('-ResumeRoot', '"C:\Temp"') -Sta
    Assert-True ($canceled.Started -eq $false) 'Ein Abbruch der Windows-Abfrage galt als gestartet.'
    Assert-True ($canceled.Canceled -eq $true) 'Der Abbruch der Windows-Abfrage wurde nicht erkannt.'
    $after = (@(Get-ChildItem -LiteralPath $marker -Recurse -File | ForEach-Object { $_.FullName + ':' + (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash }) -join ';')
    Assert-True ($before -eq $after) 'Der Abbruch hat Dateien veraendert.'

    # Ein anderer Fehler ist kein Abbruch und wird gemeldet.
    function Start-Process {
        param($FilePath, $ArgumentList, $Verb, $ErrorAction)
        throw (New-Object System.ComponentModel.Win32Exception 5)
    }
    $failed = Start-ElevatedPowerShell -ScriptPath 'x.ps1'
    Assert-True ($failed.Started -eq $false -and $failed.Canceled -eq $false) 'Ein Zugriffsfehler wurde als Abbruch gedeutet.'
    Assert-True ([bool]$failed.Message) 'Der Fehler wurde ohne Meldung verschluckt.'

    # --- 5. Simulation nur im Testmodus
    $env:FRIDAY_GUI_TEST = $null
    # Die Ablehnung steht auf stderr; PowerShell 5.1 wertet das bei ErrorActionPreference=Stop als Abbruch.
    $previousPreference = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try { $guiRun = & powershell.exe -NoProfile -STA -ExecutionPolicy Bypass -File (Join-Path $installer 'install-friday-gui.ps1') -Simulation success 2>&1 | Out-String; $guiCode = $LASTEXITCODE }
    finally { $ErrorActionPreference = $previousPreference }
    Assert-True ($guiCode -eq 2) "Die Simulation lief ohne Testmodus (Exitcode $guiCode)."
    Assert-True ($guiRun -match 'Testmodus') "Die Ablehnung nennt den Testmodus nicht: $guiRun"
    $env:FRIDAY_GUI_TEST = '1'

    # --- 6. Keine zusaetzliche GUI-Runtime und keine fremden Interpreter in den Startern
    $launchers = @('Friday installieren.bat', 'Friday installieren.vbs',
        'installer\install-friday.bat', 'installer\install-friday-gui.bat',
        'installer\install-friday-gui.vbs', 'installer\update-dashboard.bat')
    foreach ($name in $launchers) {
        $text = Get-Content -LiteralPath (Join-Path $repo $name) -Raw
        Assert-True ($text -match '(?i)(powershell\.exe|wscript\.exe|cmd\.exe|install-friday)') "$name startet keinen Windows-Starter."
        Assert-True (-not ($text -match '(?i)(dotnet|node\.exe|python|java|electron)')) "$name verlangt eine zusaetzliche Laufzeit."
    }
    $guiText = Get-Content -LiteralPath (Join-Path $installer 'install-friday-gui.ps1') -Raw
    Assert-True ($guiText.Contains('System.Windows.Forms') -and $guiText.Contains('System.Drawing')) 'Die Oberflaeche nutzt nicht die mitgelieferten Windows-Assemblies.'
    Assert-True (-not ($guiText -match '(?i)(dotnet|electron|node\.exe)')) 'Die Oberflaeche verlangt eine zusaetzliche Laufzeit.'

    # --- 7. Vor der Windows-Abfrage werden keine Geheimnisse erfasst und keine Dateien geschrieben
    $guiLines = Get-Content -LiteralPath (Join-Path $installer 'install-friday-gui.ps1')
    $elevationIndex = 0
    for ($i = 0; $i -lt $guiLines.Count; $i++) { if ($guiLines[$i] -match 'Start-ElevatedPowerShell') { $elevationIndex = $i; break } }
    Assert-True ($elevationIndex -gt 0) 'Der Start mit Administratorrechten ist nicht auffindbar.'
    $head = ($guiLines[0..$elevationIndex] -join "`n")
    foreach ($forbidden in @('Secure-Field', 'Read-Host', 'WriteAllText', 'Get-Credential', 'New-Object System.Windows.Forms.Form')) {
        Assert-True (-not $head.Contains($forbidden)) "Vor der Windows-Abfrage steht '$forbidden'."
    }
    Assert-True ($head.Contains('$isAdmin')) 'Die Rechtepruefung steht nicht vor der Oberflaeche.'

    # --- 8. Alter Starter bleibt dokumentierter Rueckweg mit demselben Ziel
    $rootBat = Get-Content -LiteralPath (Join-Path $repo 'Friday installieren.bat') -Raw
    $rootVbs = Get-Content -LiteralPath (Join-Path $repo 'Friday installieren.vbs') -Raw
    Assert-True ($rootBat.Contains('Friday installieren.vbs')) 'Der Wurzel-Starter ruft den Assistenten nicht auf.'
    Assert-True ($rootBat.Contains('installer\install-friday-gui.bat')) 'Der Rueckweg ueber die Assistenten-Batch ist nicht dokumentiert.'
    Assert-True ($rootVbs.Contains('installer\install-friday-gui.ps1')) 'Der Wurzel-Starter zeigt auf einen anderen Assistenten.'
    $anleitung = Get-Content -LiteralPath (Join-Path $installer 'ANLEITUNG.md') -Raw
    Assert-True ($anleitung.Contains('Friday installieren.bat')) 'Die Anleitung nennt den Doppelklick-Starter nicht.'
    Assert-True ($anleitung.Contains('install-friday.bat')) 'Die Anleitung nennt den CLI-Starter nicht.'
    Assert-True ($anleitung -match '(?i)(Kommandozeile|PowerShell-Fenster|CLI)') 'Die Anleitung beschreibt den CLI-Modus nicht.'

    # --- 9. Fortsetzungsstarter nennt den eigenen Zielordner
    $installerText = Get-Content -LiteralPath (Join-Path $installer 'install-friday.ps1') -Raw
    $resumeArgs = '-Resume'', ''-InstallRoot'', ''"%CD%"'''
    Assert-True ($installerText.Contains($resumeArgs)) 'Der Fortsetzungsstarter nennt den Zielordner nicht selbst.'
    # Im Quelltext steht die Zeile mit Backtick-Escapes; entscheidend sind cd /d und der eigene Ordner.
    Assert-True ($installerText.Contains('cd /d') -and $installerText.Contains('%~dp0')) 'Der Fortsetzungsstarter wechselt nicht in seinen eigenen Ordner.'
} finally {
    $env:LAUNCHER_PROBE = $null
    $env:FRIDAY_GUI_TEST = $null
    $resolved = [IO.Path]::GetFullPath($work)
    if ($resolved.StartsWith(([IO.Path]::GetFullPath($env:TEMP).TrimEnd('\') + '\'), [StringComparison]::OrdinalIgnoreCase)) {
        Remove-Item -LiteralPath $resolved -Recurse -Force -ErrorAction SilentlyContinue
    }
}

Write-Host "Starter: PASS ($script:checks Zusicherungen, echter cmd- und cscript-Lauf, UAC-Abbruch ohne Aenderung, Simulation nur im Testmodus)"