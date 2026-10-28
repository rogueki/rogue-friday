#Requires -Version 5.1
param(
    [ValidateSet('status', 'opencode', 'codex', 'claude')][string]$Cli = 'status',
    [switch]$Login,
    [string]$InstallRoot = 'C:\Friday'
)
if ($Login -and $Cli -notin @('codex', 'claude')) {
    throw '-Login ist nur fuer -Cli codex oder -Cli claude verfuegbar.'
}

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
if ($Login) {
    Write-Host 'Die Anmeldung laeuft interaktiv beim Anbieter in Friday-Ubuntu. Friday fragt kein Passwort oder Token ab.'
    & wsl.exe -d $state.distro_name -u $state.linux_user --exec bash $script login $Cli
} elseif ($Cli -eq 'status') {
    & wsl.exe -d $state.distro_name -u $state.linux_user --exec bash $script status
} else {
    & wsl.exe -d $state.distro_name -u $state.linux_user --exec bash $script install $Cli
}
if ($LASTEXITCODE -ne 0) { throw "Coding-CLI-Einrichtung fehlgeschlagen (Exitcode $LASTEXITCODE)." }
if ($Login) {
    Write-Host 'Anmeldung abgeschlossen. Modellzugriff und ein echter Coding-Auftrag wurden nicht geprueft.'
} elseif ($Cli -ne 'status') {
    Write-Host 'CLI installiert und Version geprueft. Fuer ein ChatGPT-Abo: -Cli codex -Login; fuer ein Claude-Pro/Max-Abo: -Cli claude -Login. Ein echter Coding-Auftrag steht noch aus.'
}
