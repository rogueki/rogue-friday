#Requires -Version 5.1
param([string]$InstallRoot = 'C:\Friday')

$ErrorActionPreference = 'Stop'
$root = [IO.Path]::GetFullPath($InstallRoot).TrimEnd('\')
if ($root -notmatch '^[A-Za-z]:\\.+$') { throw 'InstallRoot muss ein absoluter lokaler Laufwerkspfad sein.' }
$stateFile = Join-Path $root 'config\install-state.json'
if (-not (Test-Path -LiteralPath $stateFile -PathType Leaf)) { throw "Friday-Installation nicht gefunden: $stateFile" }
$state = Get-Content -LiteralPath $stateFile -Raw | ConvertFrom-Json
if ($state.distro_name -notmatch '^[A-Za-z][A-Za-z0-9_-]{0,31}$' -or
    $state.linux_user -notmatch '^[a-z_][a-z0-9_-]{0,31}$') {
    throw 'Im Installationszustand fehlen gueltige WSL-Distribution oder Linux-Benutzer.'
}
$distros = @(& wsl.exe --list --quiet 2>$null | ForEach-Object { ($_ -replace "`0", '').Trim() })
if ($LASTEXITCODE -ne 0 -or $state.distro_name -notin $distros) {
    throw "Gespeicherte WSL-Distribution nicht registriert: $($state.distro_name)"
}

$scriptPath = Join-Path $PSScriptRoot 'wsl\install_powerpoint_renderer.sh'
if (-not (Test-Path -LiteralPath $scriptPath -PathType Leaf)) { throw "Renderer-Helfer fehlt: $scriptPath" }
$linuxScript = @(& wsl.exe -d $state.distro_name -u root --exec wslpath -a -u $scriptPath 2>$null)
if ($LASTEXITCODE -ne 0 -or $linuxScript.Count -ne 1 -or $linuxScript[0] -notmatch '^/mnt/[a-z]/') {
    throw 'Renderer-Helfer ist in der Ziel-WSL nicht erreichbar.'
}
$linuxRoot = @(& wsl.exe -d $state.distro_name -u root --exec id -u 2>$null)
if ($LASTEXITCODE -ne 0 -or $linuxRoot[0] -ne '0') { throw 'WSL-root ist in der gespeicherten Distribution nicht verfuegbar.' }
$linuxUser = @(& wsl.exe -d $state.distro_name -u root --exec id -u $state.linux_user 2>$null)
if ($LASTEXITCODE -ne 0 -or $linuxUser.Count -ne 1 -or $linuxUser[0] -notmatch '^\d+$') {
    throw "Gespeicherter Linux-Benutzer fehlt in $($state.distro_name)."
}

Write-Host "Installiere optionalen PowerPoint-Renderer in $($state.distro_name) (Benutzer $($state.linux_user))."
& wsl.exe -d $state.distro_name -u root --exec bash $linuxScript[0]
if ($LASTEXITCODE -ne 0) { throw "PowerPoint-Renderer-Installation fehlgeschlagen (Exitcode $LASTEXITCODE)." }
& wsl.exe -d $state.distro_name -u $state.linux_user --exec bash -c 'command -v soffice && command -v pdftoppm'
if ($LASTEXITCODE -ne 0) { throw 'Renderer-Befehle sind fuer den Friday-Benutzer nicht sichtbar.' }
Write-Host 'Renderer installiert. Ein Praesentations-Renderlauf ist separat zu pruefen.'
