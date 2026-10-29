# Owner-Passwort-Reset: Hash sichern, formatgeprueft ersetzen; Passwort und Hash werden nie ausgegeben.
$ErrorActionPreference = 'Stop'
$installer = Join-Path $PSScriptRoot '..'
. (Join-Path $installer 'lib\owner-password-reset.ps1')

$script:checks = 0
function Assert-True([bool]$Condition, [string]$Message) {
    $script:checks++
    if (-not $Condition) { throw $Message }
}

$root = Join-Path $env:TEMP ('friday-owner-reset-' + [guid]::NewGuid().ToString('N'))
try {
    $oldHash = 'scrypt$16384$8$1$b2xkc2FsdA==$b2xka2V5'
    $newHash = 'scrypt$16384$8$1$bmV3c2FsdA==$bmV3a2V5'
    $hashFile = Join-Path $root 'config\dashboard_owner.hash'
    New-Item -ItemType Directory -Force -Path (Join-Path $root 'config') | Out-Null
    [IO.File]::WriteAllText($hashFile, $oldHash, (New-Object Text.UTF8Encoding $false))

    # --- Gueltiger Hash: Datei enthaelt exakt ihn, Sicherung den alten Hash
    $backup = Set-OwnerPasswordHash $root $newHash
    Assert-True ([bool]$backup -and (Test-Path -LiteralPath $backup -PathType Container)) 'Der Sicherungsordner wurde nicht angelegt.'
    $bytes = [IO.File]::ReadAllBytes($hashFile)
    Assert-True ($bytes.Length -eq ([Text.Encoding]::UTF8.GetByteCount($newHash))) 'Die Hash-Datei hat eine andere Laenge als der neue Hash.'
    Assert-True ([Text.Encoding]::UTF8.GetString($bytes) -eq $newHash) 'Die Hash-Datei enthaelt nicht exakt den neuen Hash.'
    Assert-True ($bytes[0] -ne 0xEF) 'Die Hash-Datei beginnt mit einem BOM.'
    $backupFile = Join-Path $backup 'dashboard_owner.hash'
    Assert-True (Test-Path -LiteralPath $backupFile -PathType Leaf) 'Die Sicherung der alten Hash-Datei fehlt.'
    Assert-True ((Get-Content -LiteralPath $backupFile -Raw) -eq $oldHash) 'Die Sicherung enthaelt nicht den alten Hash.'

    # --- Ungueltiger Hash: Ausnahme ohne Hash in der Meldung, Datei unveraendert
    $refused = $false
    $message = ''
    try { Set-OwnerPasswordHash $root 'klartext-passwort' | Out-Null } catch { $refused = $true; $message = $_.Exception.Message }
    Assert-True $refused 'Ein Hash im Klartextformat wurde angenommen.'
    Assert-True ($message -notmatch 'klartext') 'Die Meldung enthaelt den uebergebenen Hash.'
    Assert-True ([Text.Encoding]::UTF8.GetString([IO.File]::ReadAllBytes($hashFile)) -eq $newHash) 'Die abgelehnte Aenderung hat die Datei veraendert.'

    # --- Leere Hash-Datei: Ersteinrichtung
    [IO.File]::WriteAllText($hashFile, '', (New-Object Text.UTF8Encoding $false))
    $refused = $false
    $message = ''
    try { Set-OwnerPasswordHash $root $newHash | Out-Null } catch { $refused = $true; $message = $_.Exception.Message }
    Assert-True $refused 'Eine leere Hash-Datei wurde als Konto akzeptiert.'
    Assert-True ($message -match 'Ersteinrichtung') "Die Meldung nennt die Ersteinrichtung nicht: $message"

    # --- Fehlende Hash-Datei: Ersteinrichtung
    Remove-Item -LiteralPath $hashFile -Force
    $refused = $false
    $message = ''
    try { Set-OwnerPasswordHash $root $newHash | Out-Null } catch { $refused = $true; $message = $_.Exception.Message }
    Assert-True $refused 'Eine fehlende Hash-Datei wurde als Konto akzeptiert.'
    Assert-True ($message -match 'Ersteinrichtung') "Die Meldung nennt die Ersteinrichtung nicht: $message"
} finally {
    $verified = [IO.Path]::GetFullPath($root)
    if ($verified.StartsWith(([IO.Path]::GetFullPath($env:TEMP).TrimEnd('\') + '\'), [StringComparison]::OrdinalIgnoreCase)) {
        Remove-Item -LiteralPath $verified -Recurse -Force -ErrorAction SilentlyContinue
    }
}

# --- Das Reset-Skript parst fehlerfrei
$scriptPath = Join-Path $installer 'scripts\reset-owner-password.ps1'
$tokens = $null
$parseErrors = $null
[Management.Automation.Language.Parser]::ParseFile($scriptPath, [ref]$tokens, [ref]$parseErrors) | Out-Null
Assert-True (@($parseErrors).Count -eq 0) "reset-owner-password.ps1 hat Syntaxfehler: $(@($parseErrors) -join ' ')"

Write-Host "owner-password-reset: $script:checks checks passed"
