#Requires -Version 5.1
param(
    [ValidateSet('status', 'set')][string]$Action = 'status',
    [string]$VaultPath,
    [long]$ExpectedVersion,
    [string]$InstallRoot = 'C:\Friday'
)
$stateFile = Join-Path $InstallRoot 'config\install-state.json'
if (-not (Test-Path -LiteralPath $stateFile -PathType Leaf)) { throw 'Friday-Installation nicht gefunden.' }
$state = Get-Content -LiteralPath $stateFile -Raw | ConvertFrom-Json
if (-not $state.distro_name -or -not $state.linux_user) { throw 'WSL-Installationszustand unvollstaendig.' }
$root = [IO.Path]::GetFullPath($InstallRoot).TrimEnd('\')
if ($root -notmatch '^([A-Za-z]):\\(.+)$') { throw 'InstallRoot muss ein lokaler Laufwerkspfad sein.' }
$script = '/mnt/' + $Matches[1].ToLowerInvariant() + '/' + $Matches[2].Replace('\', '/') + '/installer/wsl/configure_obsidian.py'
if ($Action -eq 'set') {
    if ([string]::IsNullOrWhiteSpace($VaultPath)) { exit 4 }
    try { $vault = [IO.Path]::GetFullPath($VaultPath) } catch { exit 4 }
    if ($vault -notmatch '^([A-Za-z]):\\(.+)$' -or -not (Test-Path -LiteralPath (Join-Path $vault '.obsidian') -PathType Container)) {
        exit 4
    }
    $linuxVault = '/mnt/' + $Matches[1].ToLowerInvariant() + '/' + $Matches[2].Replace('\', '/')
    & wsl.exe -d $state.distro_name -u $state.linux_user --exec python3 $script set $ExpectedVersion $linuxVault
} else {
    & wsl.exe -d $state.distro_name -u $state.linux_user --exec python3 $script status
}
exit $LASTEXITCODE
