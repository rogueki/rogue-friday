# Sicherung des Stimmprofils vor einer erneuten Aufnahme.
# Die Aufnahme ueberschreibt vorhandene WAVs und das Embedding; ohne Sicherung waere ein abgebrochener
# zweiter Durchlauf ein Datenverlust. Das Manifest haelt Groesse und SHA-256 jeder Datei, damit eine
# Wiederherstellung nachweisbar vollstaendig ist und eine beschaedigte Sicherung nicht still zurueckgeschrieben wird.
$script:VoiceProfileBackupLimit = 3

function Get-VoiceProfilePath([string]$Root) {
    return (Join-Path $Root 'voice\profiles\owner')
}

function Get-VoiceProfileBackupRoot([string]$Root) {
    return (Join-Path $Root 'voice\profiles\backups')
}

function Get-VoiceProfileFiles([string]$Path) {
    if (-not (Test-Path -LiteralPath $Path -PathType Container)) { return @() }
    return @(Get-ChildItem -LiteralPath $Path -Recurse -File | Sort-Object FullName)
}

function Backup-VoiceProfile([string]$Root, [string]$Label = 'manuell') {
    # Gibt den Ordner der Sicherung zurueck, oder $null, wenn es noch kein Profil gibt (frische Installation).
    if (-not $Root) { throw 'Ohne Installationsordner gibt es kein Stimmprofil zu sichern.' }
    $source = Get-VoiceProfilePath $Root
    $files = Get-VoiceProfileFiles $source
    if ($files.Count -eq 0) { return $null }
    # Der Anbieter liefert FullName in einer anderen Schreibweise als der uebergebene Pfad (8.3 gegen lang):
    # fuer den relativen Namen muss die aufgeloeste Form die Grundlage sein.
    $resolvedSource = (Get-Item -LiteralPath $source).FullName
    $stamp = (Get-Date).ToString('yyyyMMdd-HHmmss')
    $safeLabel = ($Label -replace '[^A-Za-z0-9\-_]', '-')
    $targetRoot = Get-VoiceProfileBackupRoot $Root
    $target = Join-Path $targetRoot ("{0}-{1}" -f $stamp, $safeLabel)
    New-Item -ItemType Directory -Force -Path $target | Out-Null
    $entries = New-Object System.Collections.ArrayList
    foreach ($file in $files) {
        $relative = $file.FullName.Substring($resolvedSource.Length).TrimStart('\')
        $destination = Join-Path $target $relative
        $destinationDir = Split-Path -Parent $destination
        if ($destinationDir) { New-Item -ItemType Directory -Force -Path $destinationDir | Out-Null }
        Copy-Item -LiteralPath $file.FullName -Destination $destination -Force
        [void]$entries.Add([ordered]@{
            path = $relative
            bytes = $file.Length
            sha256 = (Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash
        })
    }
    $manifest = [ordered]@{
        v = 1
        label = $Label
        created = (Get-Date).ToString('s')
        source = $source
        files = @($entries)
    }
    $manifestPath = Join-Path $target 'manifest.json'
    [IO.File]::WriteAllText($manifestPath, ($manifest | ConvertTo-Json -Depth 5), (New-Object Text.UTF8Encoding $false))
    # Nur die juengsten Sicherungen behalten: jede Aufnahme erzeugt eine, unbegrenzt waere Plattenverbrauch.
    $existing = @(Get-VoiceProfileBackups $Root)
    if ($existing.Count -gt $script:VoiceProfileBackupLimit) {
        $existing | Select-Object -Skip $script:VoiceProfileBackupLimit | ForEach-Object {
            Remove-Item -LiteralPath $_.Path -Recurse -Force -ErrorAction SilentlyContinue
        }
    }
    return $target
}

function Get-VoiceProfileBackups([string]$Root) {
    $root = Get-VoiceProfileBackupRoot $Root
    if (-not (Test-Path -LiteralPath $root -PathType Container)) { return @() }
    return @(Get-ChildItem -LiteralPath $root -Directory | Sort-Object Name -Descending | ForEach-Object {
        $manifest = Join-Path $_.FullName 'manifest.json'
        [ordered]@{
            Path     = $_.FullName
            Name     = $_.Name
            Created  = $_.LastWriteTime
            Files    = if (Test-Path -LiteralPath $manifest) { (Get-Content -LiteralPath $manifest -Raw | ConvertFrom-Json).files } else { $null }
            Manifest = if (Test-Path -LiteralPath $manifest) { $manifest } else { $null }
        }
    })
}

function Test-VoiceProfileBackup([string]$BackupPath) {
    # Prueft jede Datei gegen das Manifest. Liefert die Probleme, statt bei der ersten Abweichung abzubrechen.
    $problems = New-Object System.Collections.ArrayList
    $manifestPath = Join-Path $BackupPath 'manifest.json'
    if (-not (Test-Path -LiteralPath $manifestPath -PathType Leaf)) {
        [void]$problems.Add('Das Manifest der Sicherung fehlt.')
        return ,$problems
    }
    $manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
    foreach ($entry in @($manifest.files)) {
        $file = Join-Path $BackupPath ([string]$entry.path)
        if (-not (Test-Path -LiteralPath $file -PathType Leaf)) {
            [void]$problems.Add("Datei fehlt in der Sicherung: $($entry.path)")
            continue
        }
        $bytes = (Get-Item -LiteralPath $file).Length
        if ($bytes -ne [int64]$entry.bytes) {
            [void]$problems.Add("Groesse weicht ab: $($entry.path) ($bytes statt $($entry.bytes))")
            continue
        }
        $hash = (Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash
        if ($hash -ne [string]$entry.sha256) { [void]$problems.Add("Pruefsumme weicht ab: $($entry.path)") }
    }
    return ,$problems
}

function Restore-VoiceProfile([string]$Root, [string]$BackupPath) {
    # Schreibt die gesicherten Dateien zurueck, nachdem jede Pruefsumme stimmt. Gibt die Anzahl zurueck.
    $problems = Test-VoiceProfileBackup $BackupPath
    if ($problems.Count -gt 0) { throw ("Die Sicherung ist nicht verwendbar: " + ($problems -join ' ')) }
    $manifest = Get-Content -LiteralPath (Join-Path $BackupPath 'manifest.json') -Raw | ConvertFrom-Json
    $target = Get-VoiceProfilePath $Root
    $restored = 0
    foreach ($entry in @($manifest.files)) {
        $source = Join-Path $BackupPath ([string]$entry.path)
        $destination = Join-Path $target ([string]$entry.path)
        $destinationDir = Split-Path -Parent $destination
        if ($destinationDir) { New-Item -ItemType Directory -Force -Path $destinationDir | Out-Null }
        Copy-Item -LiteralPath $source -Destination $destination -Force
        if ((Get-FileHash -LiteralPath $destination -Algorithm SHA256).Hash -ne [string]$entry.sha256) {
            throw "Die Wiederherstellung von $($entry.path) ist nicht identisch."
        }
        $restored++
    }
    return $restored
}
