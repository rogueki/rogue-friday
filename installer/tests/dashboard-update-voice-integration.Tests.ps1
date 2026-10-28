$ErrorActionPreference = 'Stop'
$scriptFile = Join-Path $PSScriptRoot '..\scripts\update-dashboard-github.ps1'
$tokens = $null
$errors = $null
$ast = [Management.Automation.Language.Parser]::ParseFile($scriptFile, [ref]$tokens, [ref]$errors)
if ($errors.Count) { throw "Dashboard-Updater Parserfehler: $($errors[0].Message)" }
foreach ($name in @('Git', 'Write-UpdateState', 'Assert-NoReparse', 'Get-VoiceSourcePaths', 'Test-VoicePersonaUpdateNeeded',
                   'Assert-VerifiedVoiceSources', 'Stage-VerifiedVoiceHelper',
                   'Invoke-VoicePersonaHelper', 'Restore-VoicePersonaAfterFailure')) {
    $definition = $ast.Find({ param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq $name }, $true)
    if (-not $definition) { throw "$name fehlt" }
    Invoke-Expression $definition.Extent.Text
}
$fixture = Join-Path ([IO.Path]::GetTempPath()) ('friday updater voice ' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $fixture | Out-Null
try {
    $script:root = Join-Path $fixture 'Install Root'
    $script:updates = Join-Path $root 'updates'
    $script:cache = Join-Path $fixture 'Verified Cache'
    $script:log = Join-Path $fixture 'update.log'
    $script:progressFile = Join-Path $fixture 'progress.json'
    $script:RunId = 'a' * 32
    $script:ExpectedCommit = 'b' * 40
    $script:runStartedAt = (Get-Date).ToUniversalTime().ToString('o')
    $script:processStartedAt = (Get-Process -Id $PID).StartTime.ToUniversalTime().ToString('o')
    $script:step = 4
    $script:voiceApplyStarted = $false
    New-Item -ItemType Directory -Force $updates, $cache, (Join-Path $root 'installer\voice_models'),
        (Join-Path $root 'voice'), (Join-Path $cache 'installer\scripts') | Out-Null
    foreach ($name in @('friday_ref.wav','friday_ref.txt','jarvis_ref.wav','jarvis_ref.txt')) {
        [IO.File]::WriteAllText((Join-Path $root "installer\voice_models\$name"), 'reference')
    }
    foreach ($path in (Get-VoiceSourcePaths)) {
        if ($path -like 'installer/voice/*.py') {
            [IO.File]::WriteAllText((Join-Path $root ('voice\' + [IO.Path]::GetFileName($path))), "fixture $path")
        }
    }
    if (Test-VoicePersonaUpdateNeeded @('apps/web/src/page.tsx')) { throw 'Unveraenderte Stimmen wurden ausgeloest.' }
    Remove-Item -LiteralPath (Join-Path $root 'voice\mail_voice.py')
    if (-not (Test-VoicePersonaUpdateNeeded @())) { throw 'Fehlendes Mailmodul wurde uebersehen.' }
    [IO.File]::WriteAllText((Join-Path $root 'voice\mail_voice.py'), 'restored')
    Remove-Item -LiteralPath (Join-Path $root 'voice\research_voice.py')
    if (-not (Test-VoicePersonaUpdateNeeded @())) { throw 'Fehlendes Recherchemodul wurde uebersehen.' }
    [IO.File]::WriteAllText((Join-Path $root 'voice\research_voice.py'), 'restored')
    if (-not (Test-VoicePersonaUpdateNeeded @('installer/voice/voice_persona.py'))) { throw 'Voice-Diff wurde uebersehen.' }
    if (-not (Test-VoicePersonaUpdateNeeded @('installer/scripts/update-voice-personas.ps1'))) { throw 'Helper-only-Diff wurde uebersehen.' }
    Remove-Item -LiteralPath (Join-Path $root 'installer\voice_models\jarvis_ref.wav')
    if (-not (Test-VoicePersonaUpdateNeeded @())) { throw 'Fehlende Standardreferenz wurde uebersehen.' }
    [IO.File]::WriteAllText((Join-Path $root 'installer\voice_models\jarvis_ref.wav'), 'reference')
    try { Assert-NoReparse (Join-Path $fixture 'outside.txt') $cache; throw 'Pfad ausserhalb des Cache wurde akzeptiert.' }
    catch { if ($_.Exception.Message -notmatch 'erlaubten Ordner') { throw } }

    $helperPath = Join-Path $cache 'installer\scripts\update-voice-personas.ps1'
    foreach ($path in (Get-VoiceSourcePaths)) {
        $source = Join-Path $cache $path.Replace('/', '\')
        New-Item -ItemType Directory -Force (Split-Path $source -Parent) | Out-Null
        [IO.File]::WriteAllText($source, "fixture $path")
    }
    [IO.File]::WriteAllText($helperPath, @'
param([string]$InstallRoot,[string]$SourceRoot,[string]$RunId,[string]$Mode)
$resultDir = Join-Path $InstallRoot "updates\voice-personas-$RunId"
New-Item -ItemType Directory -Force $resultDir | Out-Null
$effect = Join-Path $InstallRoot 'voice-effect.txt'
if ($Mode -eq 'Apply') {
    [IO.File]::WriteAllText($effect,'new voice')
    if (Test-Path (Join-Path $InstallRoot 'fail-apply')) { throw 'simulated apply failure' }
    [IO.File]::WriteAllText((Join-Path $resultDir 'result.json'),'{"status":"applied"}')
} elseif ($Mode -eq 'Rollback') {
    Remove-Item -LiteralPath $effect -Force -ErrorAction SilentlyContinue
    [IO.File]::WriteAllText((Join-Path $resultDir 'result.json'),'{"status":"rolledBack"}')
}
'@)
    & git.exe -C $cache init -q
    & git.exe -C $cache add -- installer
    & git.exe -C $cache -c user.name=Fixture -c user.email=fixture@example.invalid commit -qm fixture
    if ($LASTEXITCODE -ne 0) { throw 'Lokaler Git-Fixture-Commit fehlgeschlagen.' }
    $script:target = (& git.exe -C $cache rev-parse HEAD).Trim()
    Assert-VerifiedVoiceSources
    $script:voiceHelper = Stage-VerifiedVoiceHelper
    if (-not (Test-Path -LiteralPath $voiceHelper -PathType Leaf)) { throw 'Gepinnter Helper wurde nicht bereitgestellt.' }
    $voiceSource = Join-Path $cache 'installer\voice_models\jarvis_ref.wav'
    [IO.File]::AppendAllText($voiceSource, 'tampered')
    try { Assert-VerifiedVoiceSources; throw 'Manipulierte Stimmdatei wurde akzeptiert.' }
    catch { if ($_.Exception.Message -notmatch 'Git') { throw } }
    [IO.File]::WriteAllText($voiceSource, 'fixture installer/voice_models/jarvis_ref.wav')
    [IO.File]::AppendAllText($helperPath, "`n# tampered")
    try { Stage-VerifiedVoiceHelper | Out-Null; throw 'Manipulierter Helper wurde akzeptiert.' }
    catch { if ($_.Exception.Message -notmatch 'Git-Stand') { throw } }

    Invoke-VoicePersonaHelper 'Apply'
    if (-not (Test-Path -LiteralPath (Join-Path $root 'voice-effect.txt'))) { throw 'Apply hat keinen Testeffekt.' }
    $script:voiceApplyStarted = $true
    if (-not (Restore-VoicePersonaAfterFailure)) { throw 'Spaeter Dashboard-Fehler: Stimmen-Rollback fehlt.' }
    if (Test-Path -LiteralPath (Join-Path $root 'voice-effect.txt')) { throw 'Spaeter Dashboard-Fehler: Stimmen blieben geaendert.' }
    $result = Get-Content -LiteralPath (Join-Path $updates "voice-personas-$RunId\result.json") -Raw | ConvertFrom-Json
    if ($result.status -cne 'rolledBack') { throw 'Stimmen-Rollback nicht bestaetigt.' }

    [IO.File]::WriteAllText((Join-Path $root 'fail-apply'), '1')
    try { Invoke-VoicePersonaHelper 'Apply'; throw 'Fehlgeschlagenes Apply wurde akzeptiert.' }
    catch { if ($_.Exception.Message -notmatch 'Apply fehlgeschlagen') { throw } }
    if (-not (Restore-VoicePersonaAfterFailure)) { throw 'Apply-Fehler: Stimmen-Rollback fehlt.' }
    if (Test-Path -LiteralPath (Join-Path $root 'voice-effect.txt')) { throw 'Apply-Fehler: Stimmen blieben geaendert.' }
    Remove-Item -LiteralPath (Join-Path $updates "voice-personas-$RunId\result.json")
    $script:voiceHelper = Join-Path $fixture 'empty-helper.ps1'
    [IO.File]::WriteAllText($voiceHelper, 'param([string]$InstallRoot,[string]$SourceRoot,[string]$RunId,[string]$Mode)')
    try { Invoke-VoicePersonaHelper 'Apply'; throw 'Helper ohne Ergebnis wurde akzeptiert.' }
    catch { if ($_.Exception.Message -notmatch 'Ergebnisstatus') { throw } }
    Write-Output 'Dashboard-Update-Stimmenintegration: PASS'
} finally {
    $resolvedFixture = [IO.Path]::GetFullPath($fixture)
    $tempRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath())
    if (-not $resolvedFixture.StartsWith($tempRoot, [StringComparison]::OrdinalIgnoreCase)) { throw 'Unsicherer Testpfad.' }
    Remove-Item -LiteralPath $fixture -Recurse -Force
}
