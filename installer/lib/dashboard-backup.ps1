# Sicherung des Dashboards vor einem Update: Manifest mit Groesse und SHA-256 je Datei, pruefbare
# Wiederherstellung. Die Datenbank (SQLite mit WAL) gehoert dazu - ohne sie waere ein Rollback nur ein
# zurueckgespielter Build mit leerem Zustand.

function Backup-DashboardState([string]$BackupRoot, [object[]]$Entries, [string]$Reason) {
    # Entries: @{ Source = <Pfad>; Relative = <Pfad in der Sicherung> }. Fehlende Quellen werden uebersprungen
    # (frische Installation hat noch keinen Build), aber im Manifest als "fehlt" vermerkt.
    $stamp = (Get-Date).ToString('yyyyMMdd-HHmmss')
    $target = Join-Path $BackupRoot ("dashboard-$stamp")
    New-Item -ItemType Directory -Force -Path $target | Out-Null
    $manifestEntries = New-Object System.Collections.ArrayList
    foreach ($entry in @($Entries)) {
        $source = [string]$entry.Source
        $relative = [string]$entry.Relative
        if (-not (Test-Path -LiteralPath $source)) {
            [void]$manifestEntries.Add([ordered]@{ relative = $relative; state = 'fehlt'; bytes = 0; sha256 = $null })
            continue
        }
        $destination = Join-Path $target $relative
        $parent = Split-Path -Parent $destination
        if ($parent) { New-Item -ItemType Directory -Force -Path $parent | Out-Null }
        if (Test-Path -LiteralPath $source -PathType Container) {
            Copy-Item -LiteralPath $source -Destination $destination -Recurse -Force
            # Der Anbieter liefert FullName in anderer Schreibweise als der uebergebene Pfad (8.3 gegen lang).
            $resolvedSource = (Get-Item -LiteralPath $source).FullName
            foreach ($file in @(Get-ChildItem -LiteralPath $resolvedSource -Recurse -File)) {
                [void]$manifestEntries.Add([ordered]@{
                    relative = (Join-Path $relative $file.FullName.Substring($resolvedSource.Length).TrimStart('\'))
                    state = 'gesichert'
                    bytes = $file.Length
                    sha256 = (Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash
                })
            }
        } else {
            Copy-Item -LiteralPath $source -Destination $destination -Force
            [void]$manifestEntries.Add([ordered]@{
                relative = $relative
                state = 'gesichert'
                bytes = (Get-Item -LiteralPath $source).Length
                sha256 = (Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash
            })
        }
    }
    $manifest = [ordered]@{
        v = 1
        created = (Get-Date).ToString('s')
        reason = $Reason
        target = $target
        entries = @($manifestEntries)
    }
    [IO.File]::WriteAllText((Join-Path $target 'manifest.json'), ($manifest | ConvertTo-Json -Depth 6), (New-Object Text.UTF8Encoding $false))
    return $target
}

function Test-DashboardBackup([string]$BackupPath) {
    $problems = New-Object System.Collections.ArrayList
    $manifestPath = Join-Path $BackupPath 'manifest.json'
    if (-not (Test-Path -LiteralPath $manifestPath -PathType Leaf)) {
        [void]$problems.Add('Das Manifest der Sicherung fehlt.')
        return ,$problems
    }
    $manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
    if ([int]$manifest.v -ne 1) { [void]$problems.Add("Unbekannte Sicherungsversion: $($manifest.v)") }
    foreach ($entry in @($manifest.entries)) {
        if ($entry.state -eq 'fehlt') { continue }
        $file = Join-Path $BackupPath ([string]$entry.relative)
        if (-not (Test-Path -LiteralPath $file -PathType Leaf)) {
            [void]$problems.Add("Datei fehlt in der Sicherung: $($entry.relative)")
            continue
        }
        if ((Get-Item -LiteralPath $file).Length -ne [int64]$entry.bytes) {
            [void]$problems.Add("Groesse weicht ab: $($entry.relative)")
            continue
        }
        if ((Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash -ne [string]$entry.sha256) {
            [void]$problems.Add("Pruefsumme weicht ab: $($entry.relative)")
        }
    }
    return ,$problems
}

function Restore-DashboardState([string]$BackupPath, [string]$Target) {
    $problems = Test-DashboardBackup $BackupPath
    if ($problems.Count -gt 0) { throw ("Die Sicherung ist nicht verwendbar: " + ($problems -join ' ')) }
    $manifest = Get-Content -LiteralPath (Join-Path $BackupPath 'manifest.json') -Raw | ConvertFrom-Json
    $restored = 0
    foreach ($entry in @($manifest.entries)) {
        if ($entry.state -eq 'fehlt') { continue }
        $source = Join-Path $BackupPath ([string]$entry.relative)
        $destination = Join-Path $Target ([string]$entry.relative)
        $parent = Split-Path -Parent $destination
        if ($parent) { New-Item -ItemType Directory -Force -Path $parent | Out-Null }
        Copy-Item -LiteralPath $source -Destination $destination -Force
        if ((Get-FileHash -LiteralPath $destination -Algorithm SHA256).Hash -ne [string]$entry.sha256) {
            throw "Die Wiederherstellung von $($entry.relative) ist nicht identisch."
        }
        $restored++
    }
    return $restored
}
