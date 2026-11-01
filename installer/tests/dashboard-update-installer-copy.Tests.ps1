$ErrorActionPreference = 'Stop'
$scriptFile = Join-Path $PSScriptRoot '..\scripts\update-dashboard-github.ps1'
$tokens = $null
$errors = $null
$ast = [Management.Automation.Language.Parser]::ParseFile($scriptFile, [ref]$tokens, [ref]$errors)
if ($errors.Count) { throw "Dashboard-Updater Parserfehler: $($errors[0].Message)" }
foreach ($name in @('Git', 'Assert-NoReparse', 'Test-InstallerCopyPath', 'Test-KnownUpstreamBlob', 'Sync-InstallerCopy')) {
    $definition = $ast.Find({ param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq $name }, $true)
    if (-not $definition) { throw "$name fehlt" }
    Invoke-Expression $definition.Extent.Text
}
$fixture = Join-Path ([IO.Path]::GetTempPath()) ('friday updater installer ' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $fixture | Out-Null
try {
    $script:log = Join-Path $fixture 'update.log'
    $script:RunId = 'c' * 32
    $script:cache = Join-Path $fixture 'Quell Cache'
    New-Item -ItemType Directory -Force $cache | Out-Null
    & git.exe -C $cache init -q
    & git.exe -C $cache config core.autocrlf false
    New-Item -ItemType Directory -Force (Join-Path $cache 'installer\tests'), (Join-Path $cache 'installer\wsl') | Out-Null
    # Commit 0: an upstream version older than the installed one (an install whose copy was never synced).
    [IO.File]::WriteAllText((Join-Path $cache 'installer\stale.ps1'), 'uralt')
    & git.exe -C $cache add -A -- installer
    & git.exe -C $cache -c user.name=t -c user.email=t@example.invalid commit -qm '0'
    if ($LASTEXITCODE -ne 0) { throw 'Lokaler Fixture-Commit 0 fehlgeschlagen.' }
    [IO.File]::WriteAllText((Join-Path $cache 'installer\stale.ps1'), 'alt')
    [IO.File]::WriteAllText((Join-Path $cache 'installer\install-friday.ps1'), 'alt')
    [IO.File]::WriteAllText((Join-Path $cache 'installer\keep.ps1'), 'alt')
    [IO.File]::WriteAllText((Join-Path $cache 'installer\gone.ps1'), 'weg')
    [IO.File]::WriteAllText((Join-Path $cache 'installer\local.ps1'), 'alt')
    [IO.File]::WriteAllText((Join-Path $cache 'installer\tests\x.Tests.ps1'), 't')
    [IO.File]::WriteAllText((Join-Path $cache 'installer\wsl\test_y.py'), 't')
    & git.exe -C $cache add -A -- installer
    & git.exe -C $cache -c user.name=t -c user.email=t@example.invalid commit -qm 'A'
    if ($LASTEXITCODE -ne 0) { throw 'Lokaler Fixture-Commit A fehlgeschlagen.' }
    $script:installed = (& git.exe -C $cache rev-parse HEAD).Trim()
    [IO.File]::WriteAllText((Join-Path $cache 'installer\install-friday.ps1'), 'neu')
    [IO.File]::WriteAllText((Join-Path $cache 'installer\added.ps1'), 'dazu')
    Remove-Item -LiteralPath (Join-Path $cache 'installer\gone.ps1') -Force
    [IO.File]::WriteAllText((Join-Path $cache 'installer\local.ps1'), 'neu')
    [IO.File]::WriteAllText((Join-Path $cache 'installer\stale.ps1'), 'neu')
    [IO.File]::WriteAllText((Join-Path $cache 'installer\tests\x.Tests.ps1'), 't2')
    [IO.File]::WriteAllText((Join-Path $cache 'installer\wsl\test_y.py'), 't2')
    & git.exe -C $cache add -A -- installer
    & git.exe -C $cache -c user.name=t -c user.email=t@example.invalid commit -qm 'B'
    if ($LASTEXITCODE -ne 0) { throw 'Lokaler Fixture-Commit B fehlgeschlagen.' }
    $script:target = (& git.exe -C $cache rev-parse HEAD).Trim()
    & git.exe -C $cache checkout -q --detach $target
    if ($LASTEXITCODE -ne 0) { throw 'Fixture-Arbeitskopie konnte nicht ausgecheckt werden.' }
    $changed = @(& git.exe -C $cache diff --name-only --no-renames $installed $target)
    if ($changed.Count -lt 6) { throw 'Fixture-Diff ist unvollständig.' }

    $script:root = Join-Path $fixture 'Install Root'
    $script:updates = Join-Path $root 'updates'
    $script:dash = Join-Path $root 'dashboard'
    $copy = Join-Path $root 'installer'
    New-Item -ItemType Directory -Force $updates, (Join-Path $copy 'tests'), (Join-Path $copy 'wsl') | Out-Null
    [IO.File]::WriteAllText((Join-Path $copy 'install-friday.ps1'), 'alt')
    [IO.File]::WriteAllText((Join-Path $copy 'keep.ps1'), 'alt')
    [IO.File]::WriteAllText((Join-Path $copy 'gone.ps1'), 'weg')
    [IO.File]::WriteAllText((Join-Path $copy 'local.ps1'), 'eigen')
    [IO.File]::WriteAllText((Join-Path $copy 'stale.ps1'), 'uralt')
    [IO.File]::WriteAllText((Join-Path $copy 'tests\x.Tests.ps1'), 't')
    [IO.File]::WriteAllText((Join-Path $copy 'wsl\test_y.py'), 't')

    $skipped = Sync-InstallerCopy $changed
    if ((Get-Content -LiteralPath (Join-Path $copy 'stale.ps1') -Raw) -cne 'neu') { throw 'Veralteter Upstream-Stand wurde als lokale Änderung behalten.' }
    if (@($skipped) -contains 'installer/stale.ps1') { throw 'Veralteter Upstream-Stand wurde als lokale Änderung gemeldet.' }
    if ((Get-Content -LiteralPath (Join-Path $updates "installer-copy-$RunId\stale.ps1") -Raw) -cne 'uralt') { throw 'Sicherung des veralteten Stands fehlt.' }
    if ((Get-Content -LiteralPath (Join-Path $copy 'install-friday.ps1') -Raw) -cne 'neu') { throw 'Geänderte Installer-Datei wurde nicht aktualisiert.' }
    if ((Get-Content -LiteralPath (Join-Path $copy 'added.ps1') -Raw) -cne 'dazu') { throw 'Neue Installer-Datei wurde nicht kopiert.' }
    if (Test-Path -LiteralPath (Join-Path $copy 'gone.ps1')) { throw 'Gelöschte Installer-Datei blieb in der Kopie.' }
    if ((Get-Content -LiteralPath (Join-Path $copy 'local.ps1') -Raw) -cne 'eigen') { throw 'Lokale Installer-Änderung wurde überschrieben.' }
    if (@($skipped) -notcontains 'installer/local.ps1') { throw 'Lokale Installer-Änderung wurde nicht gemeldet.' }
    if ((Get-Content -LiteralPath (Join-Path $copy 'tests\x.Tests.ps1') -Raw) -cne 't') { throw 'Testdatei wurde in die Installer-Kopie geschrieben.' }
    if ((Get-Content -LiteralPath (Join-Path $copy 'wsl\test_y.py') -Raw) -cne 't') { throw 'Testdatei wurde in die Installer-Kopie geschrieben.' }
    $saved = Join-Path $updates "installer-copy-$RunId\install-friday.ps1"
    if (-not (Test-Path -LiteralPath $saved -PathType Leaf)) { throw 'Sicherung der Installer-Datei fehlt.' }
    if ((Get-Content -LiteralPath $saved -Raw) -cne 'alt') { throw 'Sicherung enthält nicht den alten Inhalt.' }

    $null = Sync-InstallerCopy $changed
    if ((Get-Content -LiteralPath (Join-Path $copy 'install-friday.ps1') -Raw) -cne 'neu') { throw 'Zweiter Lauf hat die Installer-Datei verändert.' }
    if (Test-Path -LiteralPath (Join-Path $copy 'gone.ps1')) { throw 'Zweiter Lauf hat die gelöschte Datei angelegt.' }
    if ((Get-Content -LiteralPath (Join-Path $copy 'local.ps1') -Raw) -cne 'eigen') { throw 'Zweiter Lauf hat die lokale Änderung überschrieben.' }

    $script:root = Join-Path $fixture 'Ohne Installer'
    New-Item -ItemType Directory -Force $root | Out-Null
    $result = Sync-InstallerCopy $changed
    if (@($result | Where-Object { $_ }).Count -ne 0) { throw 'Fehlender Installer-Ordner wurde nicht übersprungen.' }

    $script:root = Join-Path $fixture 'Rollback Root'
    $script:updates = Join-Path $root 'updates'
    $script:dash = Join-Path $root 'dashboard'
    $copy = Join-Path $root 'installer'
    New-Item -ItemType Directory -Force $updates, (Join-Path $copy 'tests'), (Join-Path $copy 'wsl') | Out-Null
    [IO.File]::WriteAllText((Join-Path $copy 'install-friday.ps1'), 'alt')
    [IO.File]::WriteAllText((Join-Path $copy 'keep.ps1'), 'alt')
    [IO.File]::WriteAllText((Join-Path $copy 'gone.ps1'), 'weg')
    [IO.File]::WriteAllText((Join-Path $copy 'local.ps1'), 'alt')
    [IO.File]::WriteAllText((Join-Path $copy 'tests\x.Tests.ps1'), 't')
    [IO.File]::WriteAllText((Join-Path $copy 'wsl\test_y.py'), 't')

    $script:copyCalls = 0
    $script:failOnCall = 4
    function Copy-Item {
        param([string]$LiteralPath, [string]$Destination, [switch]$Force)
        $script:copyCalls++
        if ($script:copyCalls -eq $script:failOnCall) { throw 'simulierter Kopierfehler' }
        Microsoft.PowerShell.Management\Copy-Item -LiteralPath $LiteralPath -Destination $Destination -Force:$Force
    }
    try { Sync-InstallerCopy $changed | Out-Null; throw 'Kopierfehler wurde nicht gemeldet.' }
    catch { if ($_.Exception.Message -notmatch 'Installer-Kopie konnte nicht aktualisiert werden') { throw } }
    Remove-Item -Path function:Copy-Item -Force

    if ((Get-Content -LiteralPath (Join-Path $copy 'install-friday.ps1') -Raw) -cne 'alt') { throw 'Wiederherstellung der Installer-Datei fehlt.' }
    if ((Get-Content -LiteralPath (Join-Path $copy 'gone.ps1') -Raw) -cne 'weg') { throw 'Gelöschte Installer-Datei wurde nicht wiederhergestellt.' }
    if ((Get-Content -LiteralPath (Join-Path $copy 'local.ps1') -Raw) -cne 'alt') { throw 'Lokale Installer-Datei wurde verändert.' }
    if (Test-Path -LiteralPath (Join-Path $copy 'added.ps1')) { throw 'Neu angelegte Installer-Datei blieb nach dem Fehler liegen.' }
    Write-Output 'Dashboard-Update-Installer-Kopie: PASS'
} finally {
    $resolvedFixture = [IO.Path]::GetFullPath($fixture)
    $tempRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath())
    if (-not $resolvedFixture.StartsWith($tempRoot, [StringComparison]::OrdinalIgnoreCase)) { throw 'Unsicherer Testpfad.' }
    Remove-Item -LiteralPath $fixture -Recurse -Force
}
