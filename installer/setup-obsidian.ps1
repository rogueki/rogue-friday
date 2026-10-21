#Requires -Version 5.1
param(
    [ValidateSet('status', 'set', 'ensure')][string]$Action = 'status',
    [string]$VaultPath,
    [long]$ExpectedVersion,
    [string]$InstallRoot = 'C:\Friday'
)
$root = [IO.Path]::GetFullPath($InstallRoot).TrimEnd('\')
$OutputEncoding = New-Object Text.UTF8Encoding $false
function Save-SelectedVault([string]$path) {
    $configDir = Join-Path $root 'config'
    if (-not (Test-Path -LiteralPath $configDir)) { New-Item -ItemType Directory -Path $configDir -Force | Out-Null }
    $saved = Join-Path $configDir 'obsidian-vault-path.txt'
    $temporary = "$saved.$([guid]::NewGuid().ToString('N')).tmp"
    try {
        [IO.File]::WriteAllText($temporary, $path, (New-Object Text.UTF8Encoding $false))
        Move-Item -LiteralPath $temporary -Destination $saved -Force
        [Environment]::SetEnvironmentVariable('FRIDAY_OBSIDIAN_VAULT', $path, 'User')
    } finally { Remove-Item -LiteralPath $temporary -Force -ErrorAction SilentlyContinue }
}
$stateFile = Join-Path $InstallRoot 'config\install-state.json'
if (-not (Test-Path -LiteralPath $stateFile -PathType Leaf)) { throw 'Friday-Installation nicht gefunden.' }
$state = Get-Content -LiteralPath $stateFile -Raw | ConvertFrom-Json
if (-not $state.distro_name -or -not $state.linux_user) { throw 'WSL-Installationszustand unvollstaendig.' }
if ($root -notmatch '^([A-Za-z]):\\(.+)$') { throw 'InstallRoot muss ein lokaler Laufwerkspfad sein.' }
$script = '/mnt/' + $Matches[1].ToLowerInvariant() + '/' + $Matches[2].Replace('\', '/') + '/installer/wsl/configure_obsidian.py'
if ($Action -eq 'ensure') {
    $existing = [Environment]::GetEnvironmentVariable('FRIDAY_OBSIDIAN_VAULT', 'User')
    $savedPath = Join-Path $root 'config\obsidian-vault-path.txt'
    $savedVault = if (Test-Path -LiteralPath $savedPath -PathType Leaf) { [IO.File]::ReadAllText($savedPath).Trim() } else { $null }
    $vault = if ($VaultPath) { $VaultPath } elseif ($existing) { $existing } elseif ($savedVault -and
        (Test-Path -LiteralPath (Join-Path $savedVault '.obsidian') -PathType Container)) { $savedVault } else { Join-Path $root 'memory\Friday' }
    . (Join-Path $PSScriptRoot 'ensure-obsidian-vault.ps1')
    $vault = Ensure-FridayObsidianVault -Path $vault
    $VaultPath = $vault
    # The writer works without a running Obsidian process. Report application installation separately.
    . (Join-Path $PSScriptRoot 'find-obsidian-install.ps1')
    $app = (Ensure-ObsidianInstall).path
}
if ($Action -eq 'set' -or $Action -eq 'ensure') {
    if ([string]::IsNullOrWhiteSpace($VaultPath)) { exit 4 }
    try { $vault = [IO.Path]::GetFullPath($VaultPath) } catch { exit 4 }
    if ($vault -notmatch '^([A-Za-z]):\\(.+)$' -or -not (Test-Path -LiteralPath (Join-Path $vault '.obsidian') -PathType Container)) {
        exit 4
    }
    $linuxVault = '/mnt/' + $Matches[1].ToLowerInvariant() + '/' + $Matches[2].Replace('\', '/')
    if ($Action -eq 'ensure') {
        $current = & wsl.exe -d $state.distro_name -u $state.linux_user --exec python3 $script status | ConvertFrom-Json
        if ($LASTEXITCODE -ne 0) { throw 'WSL-Vault-Status nicht abrufbar.' }
        if ($current.path -eq $linuxVault -and $current.readable) {
            & wsl.exe -d $state.distro_name -u $state.linux_user --exec systemctl --user is-active --quiet hermes-gateway.service
            if ($LASTEXITCODE -eq 0) {
                Save-SelectedVault $vault
                $current.applied = $true
                $current | Add-Member -NotePropertyName applicationPath -NotePropertyValue $app -Force
                $current | ConvertTo-Json -Compress
                exit 0
            }
        }
        $ExpectedVersion = $current.revision
    }
    $response = & wsl.exe -d $state.distro_name -u $state.linux_user --exec python3 $script set $ExpectedVersion $linuxVault
    $code = $LASTEXITCODE
    if ($code -eq 0) {
        $configured = $response | Select-Object -Last 1 | ConvertFrom-Json
        if ($configured.readable -and $configured.applied) { Save-SelectedVault $vault }
        if ($Action -eq 'ensure') {
            $configured | Add-Member -NotePropertyName applicationPath -NotePropertyValue $app -Force
            $response = $configured | ConvertTo-Json -Compress
        }
    }
    $response
    exit $code
} else {
    & wsl.exe -d $state.distro_name -u $state.linux_user --exec python3 $script status
}
exit $LASTEXITCODE
