$ErrorActionPreference = 'Stop'
# The GitHub update must survive slow links: a blobless clone, only the folders an installation uses,
# file contents in small retried batches, and no changes for folders the installer never installs.
$scriptFile = Join-Path $PSScriptRoot '..\scripts\update-dashboard-github.ps1'
$tokens = $null
$errors = $null
$ast = [Management.Automation.Language.Parser]::ParseFile($scriptFile, [ref]$tokens, [ref]$errors)
if ($errors.Count) { throw "Dashboard-Updater Parserfehler: $($errors[0].Message)" }
foreach ($name in @('Git', 'Assert-NoReparse', 'Invoke-GitNetwork', 'Test-SparseSourcePath', 'Remove-UpdateCache',
        'Initialize-UpdateCache', 'Get-MissingSourceBlobs', 'Receive-SourceBlobs')) {
    $definition = $ast.Find({ param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq $name }, $true)
    if (-not $definition) { throw "$name fehlt" }
    Invoke-Expression $definition.Extent.Text
}
foreach ($variable in @('sparsePatterns', 'notInstalledDirs', 'blobBatchSize')) {
    $assignment = $ast.Find({ param($node) $node -is [Management.Automation.Language.AssignmentStatementAst] -and
            $node.Left.Extent.Text -eq "`$$variable" }, $false)
    if (-not $assignment) { throw "`$$variable fehlt" }
    Invoke-Expression $assignment.Extent.Text
}
$script:progress = @()
function Write-UpdateState([string]$phase, [string]$message, [string]$state = 'running') { $script:progress += $message }
function Start-Sleep { }

foreach ($case in @(
        @('packages\orb\screenshots\idle.png', $true), @('adapters\hermes\test\fixtures\a.json', $true),
        @('apps\web\out\index.html', $true), @('apps\storybook\storybook-static\x.js', $true),
        @('apps\web\src\out.ts', $false), @('apps\control-api\src\outbox.ts', $false), @('apps\web\src\layout\shell.tsx', $false))) {
    if (($case[0] -match $notInstalledDirs) -ne $case[1]) { throw "Installer-Ausschluss falsch für $($case[0])" }
}
foreach ($case in @(
        @('package.json', $true), @('apps/web/src/a.ts', $true), @('installer/voice/friday_voice.py', $true),
        @('tests/e2e/a.png', $false), @('docs/x.md', $false), @('design-references/a.png', $false),
        @('packages/orb/screenshots/a.png', $false), @('adapters/hermes/test/fixtures/a.json', $false))) {
    if ((Test-SparseSourcePath $case[0]) -ne $case[1]) { throw "Download-Auswahl falsch für $($case[0])" }
}

$fixture = Join-Path ([IO.Path]::GetTempPath()) ('friday updater download ' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $fixture | Out-Null
try {
    $script:log = Join-Path $fixture 'update.log'
    $server = Join-Path $fixture 'server'
    New-Item -ItemType Directory -Force $server | Out-Null
    & git.exe -C $server init -q -b main
    & git.exe -C $server config core.autocrlf false
    & git.exe -C $server config uploadpack.allowFilter true
    & git.exe -C $server config uploadpack.allowAnySHA1InWant true
    $files = [ordered]@{
        'package.json' = '{}'; 'apps\web\src\a.ts' = 'a'; 'apps\web\src\b.ts' = 'b'; 'packages\orb\src\c.ts' = 'c'
        'installer\voice\v.py' = 'v'; 'config\themes\t.json' = 't'
        'packages\orb\screenshots\big.png' = 'png'; 'tests\e2e\x.png' = 'x'; 'docs\d.md' = 'd'
    }
    foreach ($entry in $files.GetEnumerator()) {
        $path = Join-Path $server $entry.Key
        New-Item -ItemType Directory -Force (Split-Path $path -Parent) | Out-Null
        [IO.File]::WriteAllText($path, $entry.Value)
    }
    & git.exe -C $server add -A
    & git.exe -C $server -c user.name=t -c user.email=t@example.invalid commit -qm 'A'
    if ($LASTEXITCODE -ne 0) { throw 'Fixture-Commit fehlgeschlagen.' }
    $target = (& git.exe -C $server rev-parse HEAD).Trim()

    $script:repository = 'file:///' + $server.Replace('\', '/')
    $script:updates = Join-Path $fixture 'Install Root\updates'
    $script:cache = Join-Path $updates 'rogue-friday-main'
    New-Item -ItemType Directory -Force $updates | Out-Null

    # An older full clone is replaced by a blobless one.
    & git.exe clone -q --no-checkout $repository $cache
    if ($LASTEXITCODE -ne 0) { throw 'Voll-Klon für den Test fehlgeschlagen.' }
    Initialize-UpdateCache
    if ((& git.exe -C $cache config --get remote.origin.promisor) -ne 'true') { throw 'Alter Voll-Klon wurde nicht durch einen Klon ohne Dateiinhalte ersetzt.' }
    Initialize-UpdateCache
    Invoke-GitNetwork @('-C', $cache, 'fetch', '--no-tags', 'origin', '+refs/heads/main:refs/remotes/origin/main') 'Stand abrufen' | Out-Null

    $wanted = Get-MissingSourceBlobs $target
    if ($wanted.Count -ne 6) { throw "Erwartet 6 fehlende Quelldateien, gefunden $($wanted.Count)." }
    $script:blobBatchSize = 4
    $script:progress = @()
    Receive-SourceBlobs $target
    if ($progress.Count -ne 2 -or $progress[1] -notlike '*Paket 2 von 2*') { throw "Paketweiser Download fehlt: $($progress -join ' | ')" }
    if ((Get-MissingSourceBlobs $target).Count -ne 0) { throw 'Nach dem Download fehlen noch Quelldateien.' }

    $env:GIT_NO_LAZY_FETCH = '1'
    try { Git -arguments @('-C', $cache, 'checkout', '--detach', '--force', $target) | Out-Null }
    finally { Remove-Item Env:\GIT_NO_LAZY_FETCH }
    if ((Get-Content -LiteralPath (Join-Path $cache 'apps\web\src\a.ts') -Raw) -cne 'a') { throw 'Quelldatei fehlt nach dem Checkout.' }
    if (-not (Test-Path -LiteralPath (Join-Path $cache 'package.json'))) { throw 'Root-Datei fehlt nach dem Checkout.' }
    foreach ($skipped in @('tests', 'docs', 'packages\orb\screenshots')) {
        if (Test-Path -LiteralPath (Join-Path $cache $skipped)) { throw "$skipped wurde unnötig geladen." }
    }

    $script:repository = 'file:///' + (Join-Path $fixture 'fehlt').Replace('\', '/')
    $failed = $null
    try { Invoke-GitNetwork @('ls-remote', $repository) 'Test' | Out-Null } catch { $failed = $_.Exception.Message }
    if ($failed -notlike 'GitHub-Download fehlgeschlagen (Test)*') { throw "Fehlende Quelle wurde nicht sauber gemeldet: $failed" }
    if (@(Get-Content -LiteralPath $log | Where-Object { $_ -like '*Test: Versuch * fehlgeschlagen*' }).Count -ne 3) { throw 'Wiederholungen wurden nicht protokolliert.' }

    Remove-UpdateCache
    if (Test-Path -LiteralPath $cache) { throw 'Update-Cache wurde nicht entfernt.' }
    'Dashboard-Update Download: OK'
} finally {
    Remove-Item -LiteralPath $fixture -Recurse -Force -ErrorAction SilentlyContinue
}
