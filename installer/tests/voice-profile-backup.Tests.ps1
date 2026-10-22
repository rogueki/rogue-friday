# Stimmprofil-Sicherung: vor einer zweiten Aufnahme muss das alte Profil nachweisbar gesichert sein.
$ErrorActionPreference = 'Stop'
$installer = Join-Path $PSScriptRoot '..'
. (Join-Path $installer 'lib\voice-profile-backup.ps1')

$script:checks = 0
function Assert-True([bool]$Condition, [string]$Message) {
    $script:checks++
    if (-not $Condition) { throw $Message }
}

$root = Join-Path $env:TEMP ('friday-voice-backup-' + [guid]::NewGuid().ToString('N'))
try {
    # --- Ohne Profil gibt es nichts zu sichern
    Assert-True ($null -eq (Backup-VoiceProfile $root 'leer')) 'Eine frische Installation darf keine Sicherung erzeugen.'
    Assert-True (@(Get-VoiceProfileBackups $root).Count -eq 0) 'Ohne Profil entsteht trotzdem ein Sicherungsordner.'

    # --- Profil anlegen (Embedding, WAVs, Manifest der Aufnahme)
    $owner = Join-Path $root 'voice\profiles\owner'
    New-Item -ItemType Directory -Force -Path (Join-Path $owner 'embeddings'), (Join-Path $owner 'raw\wake_hey_friday'), (Join-Path $owner 'raw\speech') | Out-Null
    $embedding = Join-Path $owner 'embeddings\owner_ecapa.npy'
    [IO.File]::WriteAllBytes($embedding, [byte[]](1..64))
    [IO.File]::WriteAllBytes((Join-Path $owner 'raw\wake_hey_friday\wake_hey_friday_001.wav'), [byte[]](65..160))
    [IO.File]::WriteAllBytes((Join-Path $owner 'raw\speech\speech_001.wav'), [Text.Encoding]::UTF8.GetBytes('speech-sample-001'))
    '{"file":"wake_hey_friday/wake_hey_friday_001.wav","block":"wake_hey_friday"}' | Set-Content -LiteralPath (Join-Path $owner 'raw\manifest.jsonl') -Encoding UTF8
    $originalHash = (Get-FileHash -LiteralPath $embedding -Algorithm SHA256).Hash

    $backup = Backup-VoiceProfile $root 'vor-enrollment'
    Assert-True ([bool]$backup) 'Die Sicherung wurde nicht angelegt.'
    Assert-True (Test-Path -LiteralPath (Join-Path $backup 'manifest.json') -PathType Leaf) 'Das Manifest der Sicherung fehlt.'
    $manifest = Get-Content -LiteralPath (Join-Path $backup 'manifest.json') -Raw | ConvertFrom-Json
    Assert-True (@($manifest.files).Count -eq 4) "Die Sicherung enthaelt $((@($manifest.files)).Count) statt vier Dateien."
    Assert-True ($manifest.label -eq 'vor-enrollment') 'Die Sicherung nennt ihren Anlass nicht.'
    Assert-True ($manifest.v -eq 1) 'Die Sicherung hat keine Vertragsversion.'
    Assert-True ([bool](@($manifest.files) | Where-Object { $_.path -eq 'embeddings\owner_ecapa.npy' -and $_.sha256 -eq $originalHash })) 'Das Embedding ist nicht mit Pruefsumme gesichert.'
    $problems = Test-VoiceProfileBackup $backup
    Assert-True ($problems.Count -eq 0) "Die frische Sicherung ist nicht fehlerfrei: $($problems -join ' ')"
    Assert-True (@(Get-VoiceProfileBackups $root).Count -eq 1) 'Die Sicherung wird nicht gefunden.'

    # --- Zweite Aufnahme ueberschreibt das Profil; die Sicherung muss unveraendert bleiben
    [IO.File]::WriteAllBytes($embedding, [Text.Encoding]::UTF8.GetBytes('speech-sample-002-neu'))
    Remove-Item -LiteralPath (Join-Path $owner 'raw\speech\speech_001.wav') -Force
    Assert-True ((Get-FileHash -LiteralPath (Join-Path $backup 'embeddings\owner_ecapa.npy') -Algorithm SHA256).Hash -eq $originalHash) 'Die Sicherung wurde durch die zweite Aufnahme veraendert.'

    # --- Wiederherstellung ist byte-identisch
    $restored = Restore-VoiceProfile $root $backup
    Assert-True ($restored -eq 4) "Wiederhergestellt wurden $restored statt vier Dateien."
    Assert-True ((Get-FileHash -LiteralPath $embedding -Algorithm SHA256).Hash -eq $originalHash) 'Das Embedding ist nach der Wiederherstellung nicht identisch.'
    Assert-True (Test-Path -LiteralPath (Join-Path $owner 'raw\speech\speech_001.wav') -PathType Leaf) 'Die geloeschte Aufnahme kam nicht zurueck.'

    # --- Beschaedigte Sicherung wird erkannt und nicht zurueckgeschrieben
    [IO.File]::WriteAllBytes((Join-Path $backup 'raw\wake_hey_friday\wake_hey_friday_001.wav'), [byte[]](9, 9, 9))
    $problems = Test-VoiceProfileBackup $backup
    Assert-True ($problems.Count -eq 1) "Eine beschaedigte Sicherung meldet $($problems.Count) statt ein Problem."
    Assert-True ($problems[0] -match 'Pruefsumme|Groesse') "Der Befund nennt keine Pruefsumme: $($problems[0])"
    [IO.File]::WriteAllBytes($embedding, [byte[]](7, 7, 7))
    $refused = $false
    try { Restore-VoiceProfile $root $backup | Out-Null } catch { $refused = $true }
    Assert-True $refused 'Eine beschaedigte Sicherung wurde trotzdem zurueckgeschrieben.'
    Assert-True ((Get-Item -LiteralPath $embedding).Length -eq 3) 'Die abgelehnte Wiederherstellung hat trotzdem Dateien ersetzt.'

    # --- Fehlende Datei im Manifest faellt auf
    Remove-Item -LiteralPath (Join-Path $backup 'manifest.json') -Force
    $problems = Test-VoiceProfileBackup $backup
    Assert-True ($problems.Count -eq 1 -and $problems[0] -match 'Manifest') 'Eine Sicherung ohne Manifest gilt als verwendbar.'

    # --- Begrenzung: nur die juengsten drei Sicherungen bleiben
    Remove-Item -LiteralPath (Get-VoiceProfileBackupRoot $root) -Recurse -Force
    foreach ($index in 1..5) {
        Backup-VoiceProfile $root "lauf-$index" | Out-Null
        Start-Sleep -Milliseconds 1100
    }
    $backups = @(Get-VoiceProfileBackups $root)
    Assert-True ($backups.Count -eq 3) "Es bleiben $($backups.Count) statt drei Sicherungen."
    Assert-True ($backups[0].Name -match 'lauf-5$') "Die neueste Sicherung ist nicht die erste: $($backups[0].Name)"
} finally {
    $verified = [IO.Path]::GetFullPath($root)
    if ($verified.StartsWith(([IO.Path]::GetFullPath($env:TEMP).TrimEnd('\') + '\'), [StringComparison]::OrdinalIgnoreCase)) {
        Remove-Item -LiteralPath $verified -Recurse -Force -ErrorAction SilentlyContinue
    }
}

# --- Verdrahtung: der Installer sichert vor der Aufnahme und laedt das Modul
$installerPath = Join-Path $installer 'install-friday.ps1'
$installerText = Get-Content -LiteralPath $installerPath -Raw
Assert-True ($installerText -match 'lib\\voice-profile-backup\.ps1') 'Der Installer laedt die Sicherung nicht.'
$callText = 'Backup-VoiceProfile -Root $Root -Label ''vor-enrollment'''
Assert-True ($installerText.Contains($callText)) 'Der Installer sichert das Profil vor der Aufnahme nicht.'
$enrollAt = $installerText.IndexOf($callText)
$recordAt = $installerText.IndexOf('enroll_record.py', $enrollAt)
Assert-True ($enrollAt -gt 0 -and $recordAt -gt $enrollAt) 'Die Sicherung liegt nicht vor der Aufnahme.'
$wiringDir = Join-Path $env:TEMP ('friday-voice-wiring-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $wiringDir -Force | Out-Null
$brokenInstall = Join-Path $wiringDir 'installer-ohne-sicherung.ps1'
[IO.File]::WriteAllText($brokenInstall, $installerText.Replace($callText, 'Write-Output ''keine Sicherung'''), (New-Object Text.UTF8Encoding $false))
$brokenText = Get-Content -LiteralPath $brokenInstall -Raw
Assert-True (-not $brokenText.Contains($callText)) 'Die Gegenprobe ohne Sicherung blieb unentdeckt.'
Remove-Item -LiteralPath $wiringDir -Recurse -Force -ErrorAction SilentlyContinue

Write-Host "Stimmprofil-Sicherung: PASS ($script:checks Zusicherungen, Sicherung und Wiederherstellung byte-identisch)"
