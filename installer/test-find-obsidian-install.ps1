$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'find-obsidian-install.ps1')
. (Join-Path $PSScriptRoot 'ensure-obsidian-vault.ps1')
$fixture = Join-Path ([IO.Path]::GetTempPath()) ('friday-obsidian-resolver-' + [guid]::NewGuid().ToString('N'))
$portable = Join-Path $fixture 'portable\Obsidian.exe'
$user = Join-Path $fixture 'user\Obsidian.exe'
$system = Join-Path $fixture 'system\Obsidian.exe'
$script:installCalls = 0
$priorLocalAppData = $env:LOCALAPPDATA
$priorObsidianApp = $env:FRIDAY_OBSIDIAN_APP
function Invoke-ObsidianPackageInstall {
    $script:installCalls++
    New-Item -ItemType Directory -Path (Split-Path $portable -Parent) -Force | Out-Null
    [IO.File]::WriteAllBytes($portable, [byte[]](77, 90, 1))
}
try {
    foreach ($path in @($user, $system)) {
        New-Item -ItemType Directory -Path (Split-Path $path -Parent) -Force | Out-Null
        [IO.File]::WriteAllBytes($path, [byte[]](77, 90, 1))
    }
    $found = Ensure-ObsidianInstall -CandidatePaths @($portable, $user, $system) -OnlyCandidates
    if ($found.path -ne $user -or $found.installed -or $script:installCalls -ne 0) { throw 'Existing user install was replaced.' }
    $found = Ensure-ObsidianInstall -CandidatePaths @($system, $user) -OnlyCandidates
    if ($found.path -ne $system -or $found.installed -or $script:installCalls -ne 0) { throw 'Existing system install was replaced.' }
    Remove-Item -LiteralPath $user, $system -Force
    $found = Ensure-ObsidianInstall -CandidatePaths @($portable) -OnlyCandidates
    if ($found.path -ne $portable -or -not $found.installed -or $script:installCalls -ne 1) { throw 'Absent install did not provision exactly once.' }
    $found = Ensure-ObsidianInstall -CandidatePaths @($portable) -OnlyCandidates
    if ($found.path -ne $portable -or $found.installed -or $script:installCalls -ne 1) { throw 'Repeat ensure reinstalled Obsidian.' }
    [IO.File]::WriteAllBytes((Join-Path $fixture 'portable\empty.exe'), [byte[]]@())
    if (Find-ObsidianInstall -CandidatePaths @((Join-Path $fixture 'portable\empty.exe')) -OnlyCandidates) {
        throw 'Empty binary was accepted.'
    }
    [IO.File]::WriteAllBytes((Join-Path $fixture 'portable\Uninstall.exe'), [byte[]](77, 90, 1))
    if (Find-ObsidianInstall -CandidatePaths @((Join-Path $fixture 'portable\Uninstall.exe')) -OnlyCandidates) {
        throw 'Uninstaller was accepted as Obsidian.'
    }
    if (Find-ObsidianInstall -CandidatePaths @((Join-Path $fixture 'old-registry\Obsidian.exe')) -OnlyCandidates) {
        throw 'Stale registered path was accepted.'
    }
    $discoveredUser = Join-Path $fixture 'LocalAppData\Obsidian\Obsidian.exe'
    New-Item -ItemType Directory -Path (Split-Path $discoveredUser -Parent) -Force | Out-Null
    [IO.File]::WriteAllBytes($discoveredUser, [byte[]](77, 90, 1))
    $env:FRIDAY_OBSIDIAN_APP = Join-Path $fixture 'stale-env\Obsidian.exe'
    $env:LOCALAPPDATA = Join-Path $fixture 'LocalAppData'
    function Get-Item {
        param([string]$LiteralPath, [string]$ErrorAction)
        if ($LiteralPath -like 'Registry::*') { throw 'Stale app-path registry entry' }
        Microsoft.PowerShell.Management\Get-Item -LiteralPath $LiteralPath -ErrorAction Stop
    }
    function Get-ChildItem {
        param([string]$LiteralPath, [string]$ErrorAction)
        if ($LiteralPath -like 'Registry::*') { return [pscustomobject]@{ PSPath = 'Registry::stale-obsidian' } }
        Microsoft.PowerShell.Management\Get-ChildItem -LiteralPath $LiteralPath -ErrorAction Stop
    }
    function Get-ItemProperty {
        param([string]$LiteralPath, [string]$ErrorAction)
        if ($LiteralPath -eq 'Registry::stale-obsidian') {
            return [pscustomobject]@{ DisplayName = 'Obsidian'; InstallLocation = (Join-Path $fixture 'stale-registry'); DisplayIcon = 'C:\stale\Uninstall.exe,0' }
        }
        Microsoft.PowerShell.Management\Get-ItemProperty -LiteralPath $LiteralPath -ErrorAction Stop
    }
    $found = Ensure-ObsidianInstall
    if ($found.path -ne $discoveredUser -or $found.installed -or $script:installCalls -ne 1) {
        throw 'Stale environment/registry did not fall back to an existing user install.'
    }
    Remove-Item Function:\Get-Item, Function:\Get-ChildItem, Function:\Get-ItemProperty
    $env:LOCALAPPDATA = $priorLocalAppData
    $env:FRIDAY_OBSIDIAN_APP = $priorObsidianApp

    $vault = Join-Path $fixture 'existing-vault'
    $settings = Join-Path $vault '.obsidian\app.json'
    New-Item -ItemType Directory -Path (Split-Path $settings -Parent) -Force | Out-Null
    [IO.File]::WriteAllText($settings, '{"theme":"user-choice"}')
    [IO.File]::WriteAllText((Join-Path $vault 'existing-note.md'), 'Original note')
    $before = (Get-FileHash -LiteralPath $settings -Algorithm SHA256).Hash
    $first = Ensure-FridayObsidianVault -Path $vault
    $second = Ensure-FridayObsidianVault -Path $vault
    if ($first -ne $vault -or $second -ne $vault -or
        (Get-FileHash -LiteralPath $settings -Algorithm SHA256).Hash -ne $before -or
        [IO.File]::ReadAllText((Join-Path $vault 'existing-note.md')) -ne 'Original note') {
        throw 'Existing vault content or settings changed.'
    }

    $installRoot = Join-Path $fixture 'missing-friday'
    $newVault = Join-Path $fixture 'must-not-create-vault'
    try {
        & powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'setup-obsidian.ps1') `
            -Action ensure -InstallRoot $installRoot -VaultPath $newVault 2>$null | Out-Null
    } catch { }
    if ($LASTEXITCODE -eq 0 -or (Test-Path -LiteralPath $newVault)) { throw 'Missing install state created a vault.' }
    New-Item -ItemType Directory -Path (Join-Path $installRoot 'config') -Force | Out-Null
    [IO.File]::WriteAllText((Join-Path $installRoot 'config\install-state.json'), '{}')
    try {
        & powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'setup-obsidian.ps1') `
            -Action ensure -InstallRoot $installRoot -VaultPath $newVault 2>$null | Out-Null
    } catch { }
    if ($LASTEXITCODE -eq 0 -or (Test-Path -LiteralPath $newVault)) { throw 'Invalid install state created a vault.' }
    Write-Output 'PASS Obsidian user/system/portable/absent/idempotent/vault/state fixtures'
} finally {
    $env:LOCALAPPDATA = $priorLocalAppData
    $env:FRIDAY_OBSIDIAN_APP = $priorObsidianApp
    $resolved = [IO.Path]::GetFullPath($fixture)
    $tempRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\') + '\'
    if ($resolved.StartsWith($tempRoot, [StringComparison]::OrdinalIgnoreCase) -and
        [IO.Path]::GetFileName($resolved) -like 'friday-obsidian-resolver-*') {
        Remove-Item -LiteralPath $resolved -Recurse -Force -ErrorAction SilentlyContinue
    }
}
