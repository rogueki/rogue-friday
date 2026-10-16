#Requires -Version 5.1
param(
    [ValidateSet('status', 'opencode', 'codex', 'claude')][string]$Cli = 'status',
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
$script = "/mnt/$drive/$relative/installer/wsl/setup_coding_cli.sh"
if ($Cli -eq 'status') {
    & wsl.exe -d $state.distro_name -u $state.linux_user --exec bash $script status
} else {
    & wsl.exe -d $state.distro_name -u $state.linux_user --exec bash $script install $Cli
}
if ($LASTEXITCODE -ne 0) { throw "Coding-CLI-Einrichtung fehlgeschlagen (Exitcode $LASTEXITCODE)." }
if ($Cli -ne 'status') {
    Write-Host 'CLI installiert und Version geprueft. Anmeldung und ein echter Coding-Auftrag stehen noch aus.'
}
