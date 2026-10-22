# Pruefsummen fuer geladene Dateien: eine falsche Datei wird geloescht, nicht still weiterverwendet.
# Die erwarteten Werte stehen im Installer fest (Qwen-Modell, Dashboard-Archiv-Digest); hier liegt nur die
# Pruefung, damit sie ohne Installationslauf testbar ist.

function Get-FileSha256([string]$Path) {
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { return $null }
    return (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()
}

function ConvertTo-Sha256Text([string]$Expected) {
    # Erlaubt "sha256:<hex>" (Digest aus einem Manifest) und Gross-/Kleinschreibung.
    if (-not $Expected) { return '' }
    return (([string]$Expected).Trim() -replace '^sha256:', '').ToLowerInvariant()
}

function Test-FileSha256([string]$Path, [string]$Expected) {
    $actual = Get-FileSha256 $Path
    $wanted = ConvertTo-Sha256Text $Expected
    if (-not $actual -or -not $wanted) { return $false }
    return ($actual -eq $wanted)
}

function Assert-FileSha256([string]$Path, [string]$Expected, [string]$Label) {
    # Gibt $true zurueck, wenn die Datei stimmt; bei Abweichung wird sie geloescht und $false gemeldet.
    if (Test-FileSha256 $Path $Expected) { return $true }
    if (Test-Path -LiteralPath $Path -PathType Leaf) {
        Remove-Item -LiteralPath $Path -Force -ErrorAction SilentlyContinue
    }
    return $false
}
