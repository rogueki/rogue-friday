# Kooperativer Abbruch: die GUI bittet einen laufenden Installer um Halt, statt ihn abzuschiessen.
# Eine Datei mit der Laufkennung ist die einzige Schnittstelle; sie ist ohne Rechte, ohne Netz und ohne
# gemeinsamen Speicher lesbar und ueberlebt einen abgestuerzten Lauf, ohne den naechsten zu stoeren.
$script:InstallerCancelFileName = 'installer.cancel'

function Get-InstallerCancelPath([string]$Root) {
    if (-not $Root) { return $null }
    return (Join-Path $Root "run\$script:InstallerCancelFileName")
}

function Request-InstallerCancel([string]$Root, [string]$RunId, [string]$Reason) {
    # Ohne Laufkennung waere die Bitte nicht zuordenbar; dann lieber gar nicht schreiben.
    if (-not $RunId) { return $null }
    $path = Get-InstallerCancelPath $Root
    if (-not $path) { return $null }
    $directory = Split-Path -Path $path -Parent
    if (-not (Test-Path -LiteralPath $directory -PathType Container)) {
        New-Item -ItemType Directory -Force -Path $directory | Out-Null
    }
    $payload = [ordered]@{
        runId        = [string]$RunId
        reason       = [string]$Reason
        requestedUtc = (Get-Date).ToUniversalTime().ToString('o')
    }
    [IO.File]::WriteAllText($path, ($payload | ConvertTo-Json -Compress), (New-Object System.Text.UTF8Encoding($false)))
    return $path
}

function Read-InstallerCancel([string]$Root) {
    $path = Get-InstallerCancelPath $Root
    if (-not $path -or -not (Test-Path -LiteralPath $path -PathType Leaf)) { return $null }
    try { $raw = Get-Content -LiteralPath $path -Raw -Encoding UTF8 } catch { return $null }
    if (-not $raw -or -not $raw.Trim()) { return $null }
    try { return ($raw | ConvertFrom-Json) } catch { return $null }
}

function Test-InstallerCancelRequested([string]$Root, [string]$RunId) {
    # Nur die eigene Laufkennung zaehlt. Eine liegen gebliebene Bitte aus einem frueheren Lauf darf
    # einen neuen Lauf nicht beenden - PIDs und Namen wiederholen sich, Laufkennungen nicht.
    if (-not $RunId) { return $false }
    $flag = Read-InstallerCancel $Root
    if (-not $flag) { return $false }
    return ([string]$flag.runId -eq [string]$RunId)
}

function Clear-InstallerCancel([string]$Root, [string]$RunId) {
    # Mit RunId wird nur die eigene Bitte entfernt; ohne RunId jede (Aufraeumen am Laufende).
    $path = Get-InstallerCancelPath $Root
    if (-not $path -or -not (Test-Path -LiteralPath $path -PathType Leaf)) { return }
    if ($RunId) {
        $flag = Read-InstallerCancel $Root
        if (-not $flag -or [string]$flag.runId -ne [string]$RunId) { return }
    }
    Remove-Item -LiteralPath $path -Force -ErrorAction SilentlyContinue
}