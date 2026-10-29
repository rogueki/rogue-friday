#Requires -Version 5.1
param([string]$InstallRoot = (Join-Path $PSScriptRoot '..\..'))

# Resets the owner password locally: back up the hash, replace it, never print password or hash.
$ErrorActionPreference = 'Stop'
$InstallRoot = [IO.Path]::GetFullPath($InstallRoot).TrimEnd('\')
. (Join-Path $PSScriptRoot '..\lib\owner-password-reset.ps1')

$node = 'C:\Program Files\nodejs\node.exe'
if (-not (Test-Path -LiteralPath $node -PathType Leaf)) {
    $node = (Get-Command node.exe -ErrorAction SilentlyContinue).Source
}
if (-not $node) {
    Write-Host 'Node.js wurde nicht gefunden. Bitte Node.js installieren oder den Installer erneut ausfuehren.'
    exit 1
}

$tsx = Join-Path $InstallRoot 'dashboard\node_modules\tsx\dist\cli.mjs'
if (-not (Test-Path -LiteralPath $tsx -PathType Leaf)) {
    Write-Host "tsx fehlt unter $tsx. Bitte den Dashboard-Schritt des Installers erneut ausfuehren."
    exit 1
}

$cli = Join-Path $InstallRoot 'dashboard\packages\auth\src\cli\hash-password.ts'
if (-not (Test-Path -LiteralPath $cli -PathType Leaf)) {
    Write-Host "Die Hash-CLI fehlt unter $cli. Bitte den Dashboard-Schritt des Installers erneut ausfuehren."
    exit 1
}

$hashFile = Join-Path $InstallRoot 'config\dashboard_owner.hash'
if (-not (Test-Path -LiteralPath $hashFile -PathType Leaf) -or (Get-Item -LiteralPath $hashFile).Length -eq 0) {
    Write-Host 'Es ist noch kein Besitzerkonto eingerichtet. Die Ersteinrichtung erfolgt im Dashboard.'
    exit 1
}

Write-Host 'Neues Owner-Passwort festlegen (mindestens 12 Zeichen, Eingabe bleibt unsichtbar).'
$output = & $node $tsx $cli
if ($LASTEXITCODE -ne 0) {
    Write-Host 'Das Passwort wurde nicht geaendert.'
    exit 1
}

$newHash = $null
foreach ($line in @($output)) {
    if ($line -match "^FRIDAY_OWNER_PASSWORD_HASH='(.+)'$") {
        $newHash = $Matches[1]
        break
    }
}
if (-not $newHash) {
    Write-Host 'Das Passwort wurde nicht geaendert.'
    exit 1
}

try {
    $backup = Set-OwnerPasswordHash $InstallRoot $newHash
} catch {
    Write-Host $_.Exception.Message
    exit 1
}

Write-Host "Passwort geaendert. Sicherung des alten Hashes: $backup"
Write-Host 'Mit dem bisherigen Benutzernamen und dem neuen Passwort anmelden; ein Neustart ist nicht noetig.'
exit 0
