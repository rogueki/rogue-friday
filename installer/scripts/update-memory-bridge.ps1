#Requires -Version 5.1
param(
    [Parameter(Mandatory=$true)][string]$InstallRoot,
    [Parameter(Mandatory=$true)][string]$SourceRoot,
    [Parameter(Mandatory=$true)][string]$RunId,
    [ValidateSet('Apply','Rollback')][string]$Mode = 'Apply'
)
$ErrorActionPreference = 'Stop'
if ($RunId -cnotmatch '^[0-9a-f]{32}$') { throw 'Ungültige Memory-Update-ID.' }
$root = [IO.Path]::GetFullPath($InstallRoot).TrimEnd('\')
$source = [IO.Path]::GetFullPath($SourceRoot).TrimEnd('\')
$run = Join-Path $root "updates\memory-bridge-$RunId"
$backup = Join-Path $run 'windows-backup'
$manifest = Join-Path $run 'manifest.json'
$result = Join-Path $run 'result.json'
$paths = @('installer\wsl\configure_memory_bridge.py', 'installer\wsl\setup_memory_bridge.sh',
    'installer\wsl\friday_memory_plugin\plugin.yaml', 'installer\wsl\friday_memory_plugin\__init__.py',
    'installer\wsl\calendar_accounts.py', 'installer\wsl\mail_accounts.py',
    'installer\wsl\configure_calendar_bridge.py',
    'installer\wsl\setup_calendar_bridge.sh', 'installer\wsl\configure_mail_bridge.py',
    'installer\wsl\setup_mail_bridge.sh', 'installer\wsl\configure_messaging_gateway.py',
    'installer\wsl\messaging_pairing.py',
    'installer\wsl\messaging_runtime.py',
    'installer\wsl\whatsapp_logout.mjs', 'installer\wsl\configure_telegram.py',
    'installer\wsl\configure_obsidian.py', 'installer\wsl\hermes_config_bridge.py',
    'installer\wsl\messaging_send.py', 'installer\wsl\messaging_config_probe.py',
    'installer\wsl\messaging_catalog.py', 'installer\wsl\messaging_catalog_probe.py',
    'installer\wsl\configure_messaging_provider.py',
    'installer\wsl\messaging_provider_apply_probe.py', 'installer\wsl\messaging_provider_fields.json',
    'installer\wsl\hermes_model_credential_apply.py', 'installer\wsl\hermes_model_catalog.py',
    'installer\wsl\hermes_plugin_activation.py', 'installer\wsl\hermes_mcp_http_apply.py',
    'installer\wsl\configure_messenger_inbound_bridge.py', 'installer\wsl\setup_messenger_inbound_bridge.sh',
    'installer\scripts\update-memory-bridge.ps1', 'installer\scripts\update-dashboard-github.ps1')

function Assert-Safe([string]$path, [string]$base) {
    $absolute = [IO.Path]::GetFullPath($path)
    $anchor = [IO.Path]::GetFullPath($base).TrimEnd('\')
    if (-not $absolute.StartsWith($anchor + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'Memory-Updatepfad außerhalb des erlaubten Bereichs.' }
    $current = $absolute
    while ($current.Length -ge $anchor.Length) {
        if (Test-Path -LiteralPath $current) {
            if (((Get-Item -LiteralPath $current -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
                throw 'Verknüpfung im Memory-Updatepfad.'
            }
        }
        if ($current -ieq $anchor) { break }
        $current = Split-Path $current -Parent
    }
}
function Wsl-Path([string]$path, [object]$state) {
    $output = & wsl.exe -d $state.distro_name -u $state.linux_user --exec wslpath -a -u $path
    if ($LASTEXITCODE -ne 0 -or -not $output) { throw 'Windows-Pfad nicht nach WSL abbildbar.' }
    return ([string]($output | Select-Object -Last 1)).Trim()
}
function Wsl-Configure([string]$mode, [object]$state, [int]$port, [string]$key = '') {
    $linuxSource = Wsl-Path (Join-Path $source 'installer') $state
    $linuxRoot = Wsl-Path $root $state
    $script = "$linuxSource/wsl/setup_memory_bridge.sh"
    $arguments = @('-d', $state.distro_name, '-u', $state.linux_user, '--exec', 'env',
        "FRIDAY_INSTALLER=$linuxSource", "FRIDAY_MEMORY_PORT=$port",
        "FRIDAY_MEMORY_SETTINGS_DB=$linuxRoot/dashboard/data/memory/outbox.sqlite", 'bash', $script, $mode, $RunId)
    $previous = $ErrorActionPreference
    try {
        $ErrorActionPreference = 'Continue'
        $output = if ($mode -eq 'apply') { $key | & wsl.exe @arguments 2>&1 } else { & wsl.exe @arguments 2>&1 }
        $code = $LASTEXITCODE
    } finally { $ErrorActionPreference = $previous }
    if ($code -ne 0) { throw "Hermes-Memory-$mode fehlgeschlagen." }
    $marker = if ($mode -eq 'apply') { 'FRIDAY_MEMORY_BRIDGE_READY' } else { 'FRIDAY_MEMORY_BRIDGE_ROLLED_BACK' }
    if ((@($output) -join "`n") -notmatch $marker) { throw "Hermes-Memory-$mode ohne Bestätigung." }
}
function Write-Result([string]$status) {
    Assert-Safe $result $root
    New-Item -ItemType Directory -Path $run -Force | Out-Null
    [IO.File]::WriteAllText($result, (@{ status = $status; runId = $RunId } | ConvertTo-Json -Compress), [Text.UTF8Encoding]::new($false))
}

Assert-Safe $run $root
$statePath = Join-Path $root 'config\install-state.json'
$state = if (Test-Path -LiteralPath $statePath -PathType Leaf) { Get-Content -LiteralPath $statePath -Raw | ConvertFrom-Json } else { $null }
$configured = $state -and $state.distro_name -and $state.linux_user
$port = 3100
$dashboardConfig = Join-Path $root 'dashboard\config\dashboard.yaml'
if (Test-Path -LiteralPath $dashboardConfig -PathType Leaf) {
    $yaml = Get-Content -LiteralPath $dashboardConfig -Raw
    if ($yaml -match '(?m)^\s+port:\s*(\d{2,5})\s*$') { $port = [int]$Matches[1] }
}
if ($Mode -eq 'Rollback') {
    if (-not (Test-Path -LiteralPath $manifest -PathType Leaf)) { throw 'Memory-Updatebackup fehlt.' }
    $existing = @(Get-Content -LiteralPath $manifest -Raw | ConvertFrom-Json)
    $wslError = $null
    if ($configured -and (Test-Path -LiteralPath (Join-Path $run 'wsl-attempted.marker') -PathType Leaf)) {
        try { Wsl-Configure 'rollback' $state $port }
        catch { $wslError = $_.Exception.Message }
    }
    foreach ($path in $paths) {
        $target = Join-Path $root $path
        $saved = Join-Path $backup $path
        Assert-Safe $target $root
        Assert-Safe $saved $root
        if ($existing -contains $path) { Copy-Item -LiteralPath $saved -Destination $target -Force }
        elseif (Test-Path -LiteralPath $target -PathType Leaf) { Remove-Item -LiteralPath $target -Force }
    }
    $keyMarker = Join-Path $run 'created-key.marker'
    if (Test-Path -LiteralPath $keyMarker -PathType Leaf) {
        $keyPath = Join-Path $root 'dashboard\data\hermes-memory-bridge\auth.key'
        Assert-Safe $keyPath $root
        if (Test-Path -LiteralPath $keyPath -PathType Leaf) { Remove-Item -LiteralPath $keyPath -Force }
    }
    if ($wslError) { throw "Memory-Windows-Dateien wiederhergestellt, Hermes-Rollback fehlgeschlagen: $wslError" }
    Write-Result 'rolledBack'
    exit 0
}

if (Test-Path -LiteralPath $result -PathType Leaf) {
    $prior = Get-Content -LiteralPath $result -Raw | ConvertFrom-Json
    if ($prior.runId -ceq $RunId -and $prior.status -in @('applied','runtimeNotConfigured')) { return }
    throw 'Memory-Update-Lauf-ID bereits verwendet.'
}

$keyPath = Join-Path $root 'dashboard\data\hermes-memory-bridge\auth.key'
foreach ($path in $paths) {
    $file = Join-Path $source $path
    Assert-Safe $file $source
    if (-not (Test-Path -LiteralPath $file -PathType Leaf)) { throw "Memory-Updatequelle fehlt: $path" }
    $gitPath = $path.Replace('\', '/')
    $tree = & git.exe -C $source ls-tree HEAD -- $gitPath
    if ($LASTEXITCODE -ne 0 -or $tree -notmatch '^100(644|755) blob ([0-9a-f]{40})\s') { throw "Memory-Updatequelle nicht im Git-Stand: $path" }
    $expected = $Matches[2]
    $actual = & git.exe -C $source hash-object --path=$gitPath -- $file
    if ($LASTEXITCODE -ne 0 -or $actual.Trim() -cne $expected) { throw "Memory-Updatequelle verändert: $path" }
}
if (Test-Path -LiteralPath $manifest) { throw 'Memory-Updatebackup existiert bereits.' }
New-Item -ItemType Directory -Path $backup -Force | Out-Null
$existing = @()
foreach ($path in $paths) {
    $target = Join-Path $root $path
    Assert-Safe $target $root
    if (Test-Path -LiteralPath $target -PathType Leaf) {
        $saved = Join-Path $backup $path
        New-Item -ItemType Directory -Path (Split-Path $saved -Parent) -Force | Out-Null
        Copy-Item -LiteralPath $target -Destination $saved -Force
        $existing += $path
    }
}
[IO.File]::WriteAllText($manifest, ($existing | ConvertTo-Json -Compress), [Text.UTF8Encoding]::new($false))
try {
    if ($configured -and -not (Test-Path -LiteralPath $keyPath -PathType Leaf)) {
        Assert-Safe $keyPath $root
        New-Item -ItemType Directory -Path (Split-Path $keyPath -Parent) -Force | Out-Null
        $bytes = [byte[]]::new(32)
        [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
        try { [IO.File]::WriteAllText($keyPath, [Convert]::ToBase64String($bytes), [Text.UTF8Encoding]::new($false)) }
        finally { [Array]::Clear($bytes, 0, $bytes.Length) }
        $principal = if ($env:USERDOMAIN) { "$env:USERDOMAIN\$env:USERNAME" } else { $env:USERNAME }
        & icacls.exe $keyPath /inheritance:r /grant:r "${principal}:(R,W)" | Out-Null
        if ($LASTEXITCODE -ne 0) { Remove-Item -LiteralPath $keyPath -Force; throw 'Hermes-Memory-Dienstschlüssel konnte nicht geschützt werden.' }
        [IO.File]::WriteAllText((Join-Path $run 'created-key.marker'), 'created', [Text.UTF8Encoding]::new($false))
    }
    $key = if ($configured) { [IO.File]::ReadAllText($keyPath).Trim() } else { '' }
    if ($configured -and $key -cnotmatch '^[A-Za-z0-9+/]{43}=$') { throw 'Hermes-Memory-Dienstschlüssel ungültig.' }
    foreach ($path in $paths) {
        $target = Join-Path $root $path
        New-Item -ItemType Directory -Path (Split-Path $target -Parent) -Force | Out-Null
        Copy-Item -LiteralPath (Join-Path $source $path) -Destination $target -Force
    }
    if ($configured) {
        [IO.File]::WriteAllText((Join-Path $run 'wsl-attempted.marker'), 'attempted', [Text.UTF8Encoding]::new($false))
        Wsl-Configure 'apply' $state $port $key
    }
    Write-Result $(if ($configured) { 'applied' } else { 'runtimeNotConfigured' })
} catch {
    $reason = $_.Exception.Message
    $wslRollback = $null
    if ($configured -and (Test-Path -LiteralPath (Join-Path $run 'wsl-attempted.marker') -PathType Leaf)) {
        try { Wsl-Configure 'rollback' $state $port }
        catch { $wslRollback = $_.Exception.Message }
    }
    foreach ($path in $paths) {
        $target = Join-Path $root $path
        $saved = Join-Path $backup $path
        if ($existing -contains $path) { Copy-Item -LiteralPath $saved -Destination $target -Force }
        elseif (Test-Path -LiteralPath $target -PathType Leaf) { Remove-Item -LiteralPath $target -Force }
    }
    if (Test-Path -LiteralPath (Join-Path $run 'created-key.marker') -PathType Leaf) {
        Remove-Item -LiteralPath $keyPath -Force -ErrorAction SilentlyContinue
    }
    if ($wslRollback) { throw "Memory-Update fehlgeschlagen; Hermes-Rollback unbestätigt: $wslRollback" }
    throw "Memory-Update fehlgeschlagen und zurückgesetzt: $reason"
} finally { $key = $null }
