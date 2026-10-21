#Requires -Version 5.1
param(
    [ValidateSet('status', 'install')][string]$Action = 'status',
    [string]$InstallRoot = 'C:\Friday'
)

$stateFile = Join-Path $InstallRoot 'config\install-state.json'
if (-not (Test-Path -LiteralPath $stateFile -PathType Leaf)) {
    throw "Friday-Installation nicht gefunden: $stateFile"
}
$state = Get-Content -LiteralPath $stateFile -Raw | ConvertFrom-Json
if (-not $state.distro_name -or -not $state.linux_user) {
    throw 'Im Installationszustand fehlen WSL-Distribution oder Linux-Benutzer.'
}
$root = [IO.Path]::GetFullPath($InstallRoot).TrimEnd('\')
if ($root -notmatch '^([A-Za-z]):\\(.+)$') {
    throw 'InstallRoot muss ein absoluter lokaler Laufwerkspfad sein.'
}
$drive = $Matches[1].ToLowerInvariant()
$relative = $Matches[2].Replace('\', '/')
$script = "/mnt/$drive/$relative/installer/wsl/setup_himalaya.sh"
& wsl.exe -d $state.distro_name -u $state.linux_user --exec bash $script $Action
if ($LASTEXITCODE -ne 0) { throw "Himalaya-Einrichtung fehlgeschlagen (Exitcode $LASTEXITCODE)." }
if ($Action -eq 'install') {
    Write-Host 'Himalaya installiert. Postfachdaten unter Einstellungen > Skill-Konten eingeben; Anbieterzugriff separat pruefen.'
}
