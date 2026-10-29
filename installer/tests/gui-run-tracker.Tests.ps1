# Prueft Laufkennung, Stillstands-Erkennung und den Drei-Stimmen-Transport. Kein Installationslauf.
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$gui = Join-Path $root 'install-friday-gui.ps1'
$backend = Join-Path $root 'install-friday.ps1'
$failures = New-Object System.Collections.Generic.List[string]
function Check([string]$Name, [bool]$Condition) {
    if ($Condition) { Write-Host "  ok   $Name" } else { $failures.Add($Name); Write-Host "  FAIL $Name" -ForegroundColor Red }
}

$tokens = $null; $errors = $null
$ast = [System.Management.Automation.Language.Parser]::ParseFile($gui, [ref]$tokens, [ref]$errors)
if ($errors.Count) { throw "GUI hat Parserfehler: $($errors[0].Message)" }
foreach ($name in @('New-RunId', 'Test-RunStalled')) {
    $node = $ast.Find({ param($n) $n -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq $name }, $true)
    if (-not $node) { throw "$name fehlt in der Oberflaeche." }
    Invoke-Expression $node.Extent.Text
}

$ids = 1..50 | ForEach-Object { New-RunId }
Check 'Laufkennung ist 12-stellig hexadezimal' (($ids | Where-Object { $_ -match '^[0-9a-f]{12}$' }).Count -eq 50)
Check 'Laufkennungen sind eindeutig' (($ids | Select-Object -Unique).Count -eq 50)

$now = Get-Date
Check 'frische Ausgabe gilt nicht als Stillstand' (-not (Test-RunStalled $now $now))
Check '14 Minuten gelten nicht als Stillstand' (-not (Test-RunStalled $now.AddMinutes(-14) $now))
Check '15 Minuten gelten als Stillstand' (Test-RunStalled $now.AddMinutes(-15) $now)
Check 'fehlender Zeitstempel blockiert nicht' (-not (Test-RunStalled $null $now))

$guiText = [IO.File]::ReadAllText($gui)
Check 'Oberflaeche setzt die Kennung in die Umgebung' ($guiText -match "EnvironmentVariables\['FRIDAY_INSTALL_RUN'\] = \`$script:runId")
Check 'Oberflaeche schreibt die Kennung ins Protokoll' ($guiText -match 'Append-Log "Lauf \$\(')
Check 'Stillstand wird nur gemeldet, nicht abgebrochen' ($guiText -match '\[HINWEIS\] Seit 15 Minuten keine Ausgabe')
Check 'kein Abbruch bei Stillstand' ($guiText -notmatch 'Process\).Kill\(\)[\s\S]{0,400}Seit 15 Minuten')

$backendText = [IO.File]::ReadAllText($backend)
Check 'Backend uebernimmt die Kennung' ($backendText -match 'FRIDAY_INSTALL_RUN')
Check 'Backend akzeptiert drei Stimmen' ($backendText -match "answers.voiceChoice -notin @\('1','2','3'\)")

# Echter Transporttest: voiceChoice 3 muss die Pruefung passieren, 4 muss abgelehnt werden.
function Invoke-Simulation([string]$voiceChoice) {
    $privateDir = Join-Path $env:LOCALAPPDATA 'FridayInstaller'
    [void][IO.Directory]::CreateDirectory($privateDir)
    $path = Join-Path $privateDir (([guid]::NewGuid().ToString('N')) + '.json')
    $answers = [ordered]@{
        assistantName = 'Friday'; wakePhrase = 'Hey Friday'; ownerName = 'Test'; about = 'Test'; linuxUser = 'friday'
        voiceMode = '1'; voiceChoice = $voiceChoice; voiceReference = ''; voiceId = ''; inputDevice = '0'; outputDevice = '0'
        address = '1'; character = '1'; length = '1'; migrateLegacy = 'false'; disableLegacy = 'false'; reuseDistro = 'false'
        disableForeignTasks = 'false'; overwriteDashboardConfig = 'false'; keepIdentity = 'false'; repeatEnrollment = 'false'
        retryEnrollment = 'false'; openBrowser = 'false'; useExistingKimi = 'true'; restartNow = 'false'
        providerChoice = '3'; modelBaseUrl = 'https://api.example.invalid/v1'; modelName = 'test-model'
    }
    $config = [ordered]@{ protocol = 1; answers = $answers; secrets = [ordered]@{}; simulation = 'success' }
    [IO.File]::WriteAllText($path, ($config | ConvertTo-Json -Depth 5 -Compress), (New-Object Text.UTF8Encoding $false))
    try {
        $env:FRIDAY_GUI_TEST = '1'
        # Ein abgelehnter Transport schreibt auf stderr; das ist hier ein erwartetes Ergebnis.
        $previousEncoding = [Console]::OutputEncoding
        [Console]::OutputEncoding = New-Object Text.UTF8Encoding $false
        $previous = $ErrorActionPreference
        $ErrorActionPreference = 'Continue'
        try {
            $output = & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $backend -GuiConfigPath $path -GuiSimulation 2>&1 | Out-String
            $code = $LASTEXITCODE
        } finally { $ErrorActionPreference = $previous; [Console]::OutputEncoding = $previousEncoding }
        return @{ Output = $output; Code = $code }
    } finally { Remove-Item -LiteralPath $path -Force -ErrorAction SilentlyContinue; Remove-Item Env:FRIDAY_GUI_TEST -ErrorAction SilentlyContinue }
}

$accepted = Invoke-Simulation '3'
Check 'voiceChoice 3 wird angenommen' ($accepted.Code -eq 0 -and $accepted.Output -match '\[GUI\] Prüfung von Stimme und Schlüssel')
$rejected = Invoke-Simulation '4'
Check 'voiceChoice 4 wird abgelehnt' ($rejected.Code -ne 0 -and $rejected.Output -match 'Ungültige GUI-Auswahl: voiceChoice')

if ($failures.Count) { Write-Host "Laufkennung/Stimmen-Transport: $($failures.Count) Fehler" -ForegroundColor Red; exit 1 }
Write-Host 'Laufkennung, Stillstandsmeldung und Drei-Stimmen-Transport: PASS'