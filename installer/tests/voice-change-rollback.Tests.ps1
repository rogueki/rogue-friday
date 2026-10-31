# Sprachbetrieb wechseln: bricht der Installer ab, bleibt der bisherige Sprachbetrieb aktiv (LG-4.03).
# Restore-VoiceChange wird aus dem Installer geholt und gegen nachgebildete Windows-Aufgaben ausgefuehrt.
$ErrorActionPreference = 'Stop'
$installer = Join-Path $PSScriptRoot '..\install-friday.ps1'
$tokens = $null
$errors = $null
$ast = [System.Management.Automation.Language.Parser]::ParseFile($installer, [ref]$tokens, [ref]$errors)
if ($errors.Count) { throw "Installer hat PowerShell-Parserfehler: $($errors[0].Message)" }
$definition = $ast.Find({ param($node) $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq 'Restore-VoiceChange' }, $true)
if (-not $definition) { throw 'Restore-VoiceChange fehlt.' }
Invoke-Expression $definition.Extent.Text
$script:checks = 0
function Assert-True([bool]$Condition, [string]$Message) {
    $script:checks++
    if (-not $Condition) { throw $Message }
}

# --- Reihenfolge im Installer: erst sichern, dann Modus speichern; Abbruch stellt wieder her; nach dem Sprachdienst nicht mehr
$text = [IO.File]::ReadAllText($installer)
$backupAt = $text.IndexOf('$script:VoiceChangeRollback = @{')
$choiceAt = $text.IndexOf("Title 'Sprachbetrieb wählen'")
$qwenOffAt = $text.IndexOf("Disable-ScheduledTask -TaskName 'FRIDAY_Qwen' | Out-Null")
Assert-True ($backupAt -gt 0 -and $choiceAt -gt $backupAt) 'Die Stimmen-Sicherung entsteht erst nach der Moduswahl; sie enthielte dann schon den neuen Modus.'
Assert-True ($qwenOffAt -gt $backupAt) 'FRIDAY_Qwen wird vor der Sicherung abgeschaltet.'
Assert-True ($text -match "function Stop-Install\(\`$text\) \{\s+Write-GuiRunDone 1 'failed'\s+Write-Host [^\r\n]+\s+Restore-VoiceChange") 'Stop-Install stellt den bisherigen Sprachbetrieb nicht wieder her.'
Assert-True ($text -match "MarkDone 'voiceservice'\s+#[^\r\n]*\s+\`$script:VoiceChangeRollback = \`$null") 'Nach erfolgreichem Sprachdienst wird die Rueckkehr nicht freigegeben.'

# --- Nachbildung der Umgebung
$temp = Join-Path ([IO.Path]::GetTempPath()) ("friday-voice-rollback-" + [guid]::NewGuid().ToString('N'))
$script:Root = Join-Path $temp 'root'
$script:StateFile = Join-Path $Root 'config\install-state.json'
$script:ProcessRoots = @("$Root\")
$script:Ports = @{ Qwen = 43692 }
$script:calls = New-Object Collections.ArrayList
$script:voiceRunning = $true
$script:qwenState = 'Disabled'
function Test-VoiceServiceRunning { return $script:voiceRunning }
function Stop-VoiceService { [void]$script:calls.Add('stop-voice'); $script:voiceRunning = $false }
function Test-TaskForInstallRoot($task) { return [bool]$task }
function Get-ScheduledTask([string]$TaskName, $ErrorAction) {
    if ($TaskName -eq 'FRIDAY_Qwen') { return [pscustomobject]@{ TaskName = 'FRIDAY_Qwen'; State = $script:qwenState } }
    if ($TaskName -eq 'FRIDAY_Voice') { return [pscustomobject]@{ TaskName = 'FRIDAY_Voice'; State = 'Ready' } }
    return $null
}
function Enable-ScheduledTask([string]$TaskName, $ErrorAction) { [void]$script:calls.Add("enable-$TaskName"); $script:qwenState = 'Ready' }
function Disable-ScheduledTask([string]$TaskName, $ErrorAction) { [void]$script:calls.Add("disable-$TaskName"); $script:qwenState = 'Disabled' }
function Start-ScheduledTask([string]$TaskName, $ErrorAction) { [void]$script:calls.Add("start-$TaskName") }
function Stop-LauncherService { [void]$script:calls.Add("stop-launcher-$($args[0])") }

function New-Scenario([bool]$QwenEnabled, [string]$QwenNow) {
    if (Test-Path -LiteralPath $temp) { Remove-Item -LiteralPath $temp -Recurse -Force }
    $backup = Join-Path $temp 'backup'
    New-Item -ItemType Directory -Force -Path (Join-Path $Root 'config\voice-references'), (Join-Path $backup 'voice-references') | Out-Null
    Set-Content -LiteralPath $StateFile -Value '{"voice_mode":"elevenlabs"}' -Encoding UTF8
    Set-Content -LiteralPath (Join-Path $Root 'config\voice.json') -Value '{"voice_mode":"elevenlabs"}' -Encoding UTF8
    Set-Content -LiteralPath (Join-Path $Root 'config\voice-references\new.wav') -Value 'neu' -Encoding UTF8
    Set-Content -LiteralPath (Join-Path $backup 'install-state.json') -Value '{"voice_mode":"local"}' -Encoding UTF8
    Set-Content -LiteralPath (Join-Path $backup 'voice.json') -Value '{"voice_mode":"local"}' -Encoding UTF8
    Set-Content -LiteralPath (Join-Path $backup 'voice-references\old.wav') -Value 'alt' -Encoding UTF8
    $script:calls.Clear()
    $script:voiceRunning = $true
    $script:qwenState = $QwenNow
    $script:VoiceChangeRollback = @{ Backup = $backup; QwenEnabled = $QwenEnabled }
}

try {
    # 1. Lokal -> ElevenLabs bricht ab: Dateien zurueck, FRIDAY_Qwen wieder an, Sprachdienst neu gestartet
    New-Scenario $true 'Disabled'
    Restore-VoiceChange 6>$null
    Assert-True ((Get-Content -LiteralPath $StateFile -Raw) -match '"local"') 'install-state.json wurde nicht zurueckgesetzt.'
    Assert-True ((Get-Content -LiteralPath (Join-Path $Root 'config\voice.json') -Raw) -match '"local"') 'voice.json wurde nicht zurueckgesetzt.'
    Assert-True ((Test-Path -LiteralPath (Join-Path $Root 'config\voice-references\old.wav')) -and
        -not (Test-Path -LiteralPath (Join-Path $Root 'config\voice-references\new.wav'))) 'Die Referenzaufnahmen wurden nicht zurueckgesetzt.'
    Assert-True (($calls -join ',') -eq 'stop-voice,enable-FRIDAY_Qwen,start-FRIDAY_Qwen,start-FRIDAY_Voice') "Falsche Reihenfolge beim Wiederherstellen: $($calls -join ',')"
    Assert-True ($null -eq $script:VoiceChangeRollback) 'Die Rueckkehr laeuft ein zweites Mal.'

    # 2. ElevenLabs -> lokal bricht ab, nachdem FRIDAY_Qwen schon lief: wieder abschalten
    New-Scenario $false 'Ready'
    Restore-VoiceChange 6>$null
    Assert-True (($calls -join ',') -eq 'stop-voice,stop-launcher-FRIDAY_Qwen,disable-FRIDAY_Qwen,start-FRIDAY_Voice') "FRIDAY_Qwen bleibt nach dem Abbruch an: $($calls -join ',')"

    # 3. Ohne Wechsel passiert nichts
    $script:calls.Clear()
    $script:VoiceChangeRollback = $null
    Restore-VoiceChange 6>$null
    Assert-True ($calls.Count -eq 0) 'Restore-VoiceChange greift ohne laufenden Sprachwechsel ein.'

    # 4. Fehlende Sicherung: Warnung statt Absturz, damit Stop-Install seine Meldung noch zeigt
    New-Scenario $true 'Disabled'
    Remove-Item -LiteralPath (Join-Path $temp 'backup\voice.json')
    $output = Restore-VoiceChange 6>&1 | Out-String
    Assert-True ($output -match 'nicht vollständig wiederhergestellt') 'Eine unvollstaendige Sicherung wird nicht gemeldet.'
} finally {
    if (Test-Path -LiteralPath $temp) { Remove-Item -LiteralPath $temp -Recurse -Force }
}
Write-Host "Sprachwechsel-Rueckkehr: $($script:checks) Pruefungen bestanden"
Write-Host 'Sprachwechsel-Rueckkehr: PASS'
