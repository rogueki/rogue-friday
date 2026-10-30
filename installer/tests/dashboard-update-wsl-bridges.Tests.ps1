$ErrorActionPreference = 'Stop'
$repo = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$updaterText = Get-Content -LiteralPath (Join-Path $repo 'installer\scripts\update-dashboard-github.ps1') -Raw
$helperText = Get-Content -LiteralPath (Join-Path $repo 'installer\scripts\update-memory-bridge.ps1') -Raw
$helperHeader = [regex]::Split($helperText, 'function Assert-Safe', 2)[0]
$payload = @([regex]::Matches($helperHeader, "'installer\\[^']+'") | ForEach-Object { $_.Value.Trim("'") })
if ($payload.Count -lt 15) { throw 'WSL-Bridge-Payload ist unvollständig.' }
if (@($payload | Where-Object { $_ -like 'installer\config\*' -or $_ -like 'installer\data\*' -or $_ -like 'installer\secrets\*' }).Count) { throw 'Nutzerdaten im Bridge-Payload.' }
foreach ($path in $payload) {
    if (-not (Test-Path -LiteralPath (Join-Path $repo $path) -PathType Leaf)) { throw "Clean-Install-Asset fehlt: $path" }
}
$installerText = Get-Content -LiteralPath (Join-Path $repo 'installer\install-friday.ps1') -Raw
if ($installerText -notmatch 'robocopy\.exe\s+\$PSScriptRoot\s+\$Inst\s+/E') { throw 'Clean-Install kopiert Installer-Payload nicht.' }
$selfCopy = ($installerText -split "`n" | Where-Object { $_ -match 'robocopy\.exe\s+\$PSScriptRoot\s+\$Inst' } | Select-Object -First 1)
foreach ($excluded in @('tests', 'test', 'fixtures', 'test_*.py', '*.Tests.ps1')) {
    if ($selfCopy -notmatch "\s$([regex]::Escape($excluded))\s") { throw "Installer-Selbstkopie liefert '$excluded' aus." }
}

$tokens = $null; $errors = $null
$ast = [Management.Automation.Language.Parser]::ParseInput($updaterText, [ref]$tokens, [ref]$errors)
if ($errors.Count) { throw "Updater-Syntaxfehler: $($errors[0].Message)" }
foreach ($name in @('Get-WslBridgeSourcePaths', 'Test-MemoryUpdateNeeded')) {
    $definition = $ast.Find({ param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq $name }, $true)
    if (-not $definition) { throw "Updater-Funktion fehlt: $name" }
    Invoke-Expression $definition.Extent.Text
}
$bridgePaths = @(Get-WslBridgeSourcePaths | ForEach-Object { $_.Replace('/', '\') })
foreach ($path in $bridgePaths) {
    if ($payload -cnotcontains $path) { throw "Bridge-Quelle fehlt im verifizierten Helper: $path" }
}

$fixture = Join-Path ([IO.Path]::GetTempPath()) ('friday-wsl-update-' + [guid]::NewGuid().ToString('N'))
$script:root = Join-Path $fixture 'install'
$source = Join-Path $fixture 'source'
New-Item -ItemType Directory -Force $root, $source | Out-Null
try {
    foreach ($path in $payload) {
        $destination = Join-Path $source $path
        New-Item -ItemType Directory -Force (Split-Path $destination -Parent) | Out-Null
        Copy-Item -LiteralPath (Join-Path $repo $path) -Destination $destination
    }
    $voiceRelative = 'installer\scripts\update-voice-personas.ps1'
    Copy-Item -LiteralPath (Join-Path $repo $voiceRelative) -Destination (Join-Path $source $voiceRelative)
    & git.exe -C $source init -q
    & git.exe -C $source config core.autocrlf false
    & git.exe -C $source add -- installer
    & git.exe -C $source -c user.name=Fixture -c user.email=fixture@example.invalid commit -qm fixture
    if ($LASTEXITCODE -ne 0) { throw 'Synthetischer Git-Quellstand fehlt.' }
    $probe = & git.exe -C $source ls-tree HEAD -- installer/wsl/configure_memory_bridge.py
    if ($probe -notmatch '^100(644|755) blob [0-9a-f]{40}\s') { throw "Synthetischer Git-Blob fehlt: $probe" }
    $oldPath = Join-Path $root 'installer\wsl\configure_messaging_gateway.py'
    New-Item -ItemType Directory -Force (Split-Path $oldPath -Parent) | Out-Null
    [IO.File]::WriteAllText($oldPath, 'old bridge')
    $private = Join-Path $root 'config\dashboard.yaml'
    New-Item -ItemType Directory -Force (Split-Path $private -Parent) | Out-Null
    [IO.File]::WriteAllText($private, 'private fixture')
    if (-not (Test-MemoryUpdateNeeded @())) { throw 'Fehlende Bridge im alten Installationsbaum nicht erkannt.' }
    if (-not (Test-MemoryUpdateNeeded @('installer/wsl/calendar_accounts.py'))) { throw 'Bridge-Diff nicht erkannt.' }
    $runId = 'a' * 32
    $helper = Join-Path $source 'installer\scripts\update-memory-bridge.ps1'
    # Exercise the real installed updater's voice decision and verified helper handoff from the pre-memory release.
    $oldText = (& git.exe -C $repo show '6e168d1:installer/scripts/update-dashboard-github.ps1') -join "`n"
    if ($LASTEXITCODE -ne 0 -or -not $oldText) { throw 'Installierter Vor-Memory-Updater ist nicht lesbar.' }
    $oldAst = [Management.Automation.Language.Parser]::ParseInput($oldText, [ref]$tokens, [ref]$errors)
    if ($errors.Count) { throw 'Installierter Vor-Memory-Updater ist syntaktisch ungültig.' }
    foreach ($name in @('Git', 'Assert-NoReparse', 'Get-VoiceSourcePaths', 'Test-VoicePersonaUpdateNeeded', 'Stage-VerifiedVoiceHelper')) {
        $definition = $oldAst.Find({ param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq $name }, $true)
        if (-not $definition) { throw "Installierter Updater-Hook fehlt: $name" }
        Invoke-Expression $definition.Extent.Text
    }
    if (-not (Test-VoicePersonaUpdateNeeded @('installer/voice/friday_voice.py'))) { throw 'Alter Updater löst neuen Voice-Helper nicht aus.' }
    $script:cache = $source
    $script:target = (& git.exe -C $source rev-parse HEAD).Trim()
    $script:updates = Join-Path $root 'updates'
    $script:log = Join-Path $fixture 'update.log'
    $script:RunId = $runId
    New-Item -ItemType Directory -Force $updates | Out-Null
    $stagedVoice = Stage-VerifiedVoiceHelper
    if (-not (Test-Path -LiteralPath $stagedVoice -PathType Leaf)) { throw 'Alter Updater stellte neuen Voice-Helper nicht bereit.' }
    $voiceAst = [Management.Automation.Language.Parser]::ParseFile($stagedVoice, [ref]$tokens, [ref]$errors)
    if ($errors.Count) { throw 'Neuer Voice-Helper ist syntaktisch ungültig.' }
    foreach ($name in @('Assert-Ordinary', 'Assert-PathSafe', 'Invoke-NativeCaptured', 'Invoke-MemoryUpgrade')) {
        $definition = $voiceAst.Find({ param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq $name }, $true)
        if (-not $definition) { throw "Voice-zu-Memory-Hook fehlt: $name" }
        Invoke-Expression $definition.Extent.Text
    }
    Invoke-MemoryUpgrade 'Apply'
    $result = Get-Content -LiteralPath (Join-Path $root "updates\memory-bridge-$runId\result.json") -Raw | ConvertFrom-Json
    if ($result.status -cne 'runtimeNotConfigured') { throw 'Bridge-Apply ohne korrekten Ergebnisstatus.' }
    foreach ($path in $payload) {
        $installed = Join-Path $root $path
        if (-not (Test-Path -LiteralPath $installed -PathType Leaf)) { throw "Bridge-Bootstrap fehlt: $path" }
        if ((Get-FileHash -LiteralPath $installed -Algorithm SHA256).Hash -cne
            (Get-FileHash -LiteralPath (Join-Path $source $path) -Algorithm SHA256).Hash) { throw "Bridge-Inhalt falsch: $path" }
    }
    if (Test-MemoryUpdateNeeded @()) { throw 'Vollständige Installation weiterhin als fehlend erkannt.' }
    if (-not (Test-MemoryUpdateNeeded @('installer/wsl/calendar_accounts.py'))) { throw 'Geänderter Bridge-Helfer löst kein Update aus.' }
    if ((Get-Content -LiteralPath $private -Raw) -cne 'private fixture') { throw 'Nutzerkonfiguration verändert.' }
    Invoke-MemoryUpgrade 'Rollback'
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $helper -InstallRoot $root -SourceRoot $source -RunId $runId -Mode Rollback
    if ($LASTEXITCODE -ne 0) { throw 'Zweites Rollback aus Voice-/Dashboard-Kette fehlgeschlagen.' }
    if ((Get-Content -LiteralPath $oldPath -Raw) -cne 'old bridge') { throw 'Alter Bridge-Stand nicht wiederhergestellt.' }
    if (Test-Path -LiteralPath (Join-Path $root 'installer\wsl\calendar_accounts.py')) { throw 'Neu eingeführte Bridge nach Rollback verblieben.' }
    if ((Get-Content -LiteralPath $private -Raw) -cne 'private fixture') { throw 'Nutzerkonfiguration beim Rollback verändert.' }
    [IO.File]::AppendAllText((Join-Path $source 'installer\wsl\calendar_accounts.py'), 'tampered')
    $previousPreference = $ErrorActionPreference
    try {
        $ErrorActionPreference = 'Continue'
        & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $helper -InstallRoot $root -SourceRoot $source -RunId ('b' * 32) -Mode Apply 2>&1 | Out-Null
    } finally { $ErrorActionPreference = $previousPreference }
    if ($LASTEXITCODE -eq 0) { throw 'Manipulierte Git-Quelle wurde akzeptiert.' }
    if ((Get-Content -LiteralPath $oldPath -Raw) -cne 'old bridge') { throw 'Quellfehler veränderte alte Bridge.' }
    Copy-Item -LiteralPath (Join-Path $repo 'installer\wsl\calendar_accounts.py') -Destination (Join-Path $source 'installer\wsl\calendar_accounts.py') -Force
    $configuredRoot = Join-Path $fixture 'configured-install'
    $configuredConfig = Join-Path $configuredRoot 'config\install-state.json'
    $configuredKey = Join-Path $configuredRoot 'dashboard\data\hermes-memory-bridge\auth.key'
    New-Item -ItemType Directory -Force (Split-Path $configuredConfig -Parent), (Split-Path $configuredKey -Parent) | Out-Null
    [IO.File]::WriteAllText($configuredConfig, '{"distro_name":"Friday-Test","linux_user":"tester"}')
    [IO.File]::WriteAllText($configuredKey, ('A' * 43 + '='))
    $configuredOld = Join-Path $configuredRoot 'installer\wsl\configure_messaging_gateway.py'
    New-Item -ItemType Directory -Force (Split-Path $configuredOld -Parent) | Out-Null
    [IO.File]::WriteAllText($configuredOld, 'old configured bridge')
    $runner = Join-Path $fixture 'wsl-stub-runner.ps1'
    [IO.File]::WriteAllText($runner, @'
param([string]$Helper,[string]$InstallRoot,[string]$SourceRoot,[string]$RunId,[string]$Mode,[string]$CallLog,[string]$FailApply)
function wsl.exe {
    if ($args -contains 'wslpath') { $global:LASTEXITCODE = 0; return '/mnt/fixture/installer' }
    $action = if ($args -contains 'apply') { 'apply' } elseif ($args -contains 'rollback') { 'rollback' } else { 'unknown' }
    Add-Content -LiteralPath $CallLog -Value $action
    if ($action -eq 'apply' -and $FailApply -eq '1') { $global:LASTEXITCODE = 1; return 'synthetic WSL failure' }
    $global:LASTEXITCODE = 0
    if ($action -eq 'apply') { return 'FRIDAY_MEMORY_BRIDGE_READY' }
    return 'FRIDAY_MEMORY_BRIDGE_ROLLED_BACK'
}
. $Helper -InstallRoot $InstallRoot -SourceRoot $SourceRoot -RunId $RunId -Mode $Mode
'@)
    $callLog = Join-Path $fixture 'wsl-calls.txt'
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $runner -Helper $helper -InstallRoot $configuredRoot -SourceRoot $source -RunId ('c' * 32) -Mode Apply -CallLog $callLog -FailApply 0
    if ($LASTEXITCODE -ne 0 -or (Get-Content -LiteralPath $callLog -Raw) -notmatch 'apply') { throw 'Konfigurierte WSL-Anwendung nicht bestätigt.' }
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $runner -Helper $helper -InstallRoot $configuredRoot -SourceRoot $source -RunId ('c' * 32) -Mode Rollback -CallLog $callLog -FailApply 0
    if ($LASTEXITCODE -ne 0 -or (Get-Content -LiteralPath $callLog -Raw) -notmatch 'rollback') { throw 'Konfiguriertes WSL-Rollback nicht bestätigt.' }
    if ((Get-Content -LiteralPath $configuredOld -Raw) -cne 'old configured bridge') { throw 'Konfigurierter Altstand nicht wiederhergestellt.' }
    if ((Get-Content -LiteralPath $configuredKey -Raw) -cne ('A' * 43 + '=')) { throw 'Bestehender Dienstschlüssel verändert.' }
    $previousPreference = $ErrorActionPreference
    try {
        $ErrorActionPreference = 'Continue'
        & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $runner -Helper $helper -InstallRoot $configuredRoot -SourceRoot $source -RunId ('d' * 32) -Mode Apply -CallLog $callLog -FailApply 1 2>&1 | Out-Null
    } finally { $ErrorActionPreference = $previousPreference }
    if ($LASTEXITCODE -eq 0) { throw 'Fehlgeschlagenes WSL-Apply wurde akzeptiert.' }
    $calls = @(Get-Content -LiteralPath $callLog)
    if (($calls | Select-Object -Last 2) -join ',' -cne 'apply,rollback') { throw 'WSL-Fehler wurde nicht mit Rollback kompensiert.' }
    if ((Get-Content -LiteralPath $configuredOld -Raw) -cne 'old configured bridge') { throw 'WSL-Fehler ließ neuen Bridge-Stand zurück.' }
    if (Test-Path -LiteralPath (Join-Path $configuredRoot 'installer\wsl\calendar_accounts.py')) { throw 'WSL-Fehler ließ neue Bridge-Datei zurück.' }
    if ((Get-Content -LiteralPath $configuredKey -Raw) -cne ('A' * 43 + '=')) { throw 'WSL-Fehler veränderte Dienstschlüssel.' }
    Write-Output 'Dashboard-Update-WSL-Bridges: PASS'
} finally {
    $absolute = [IO.Path]::GetFullPath($fixture)
    $tempRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\') + '\'
    if (-not $absolute.StartsWith($tempRoot, [StringComparison]::OrdinalIgnoreCase)) { throw 'Unsicherer Testpfad.' }
    Remove-Item -LiteralPath $fixture -Recurse -Force
}
