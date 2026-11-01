$ErrorActionPreference = 'Stop'
# The repository's test world (mock data, mock adapter, Storybook) never reaches an installation: the installer does not
# copy it, removes it from older installations, and the GitHub updater neither downloads nor installs it.
function Assert-True([bool]$Condition, [string]$Message) { if (-not $Condition) { throw $Message } }
$installerDir = Split-Path $PSScriptRoot -Parent
. (Join-Path $installerDir 'lib\dashboard-sync.ps1')

function Write-Fixture([string]$Path, [string]$Text = 'x') {
    New-Item -ItemType Directory -Force (Split-Path $Path -Parent) | Out-Null
    [IO.File]::WriteAllText($Path, $Text)
}

$fixture = Join-Path ([IO.Path]::GetTempPath()) ('friday test world ' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $fixture | Out-Null
try {
    # --- 1. Installer: source hash and copy leave the test world out
    $source = Join-Path $fixture 'Quelle'
    $target = Join-Path $fixture 'Ziel'
    foreach ($relative in @('apps\web\page.ts', 'apps\control-api\main.ts', 'packages\ui\ui.ts', 'adapters\hermes\hermes.ts',
                            'apps\storybook\story.ts', 'adapters\mock\mock.ts', 'packages\mock-data\world.ts', 'package.json')) {
        Write-Fixture (Join-Path $source $relative)
    }
    $files = Get-DashboardSourceFiles -Source $source -RootFiles @('package.json') -Dirs @('apps', 'packages', 'adapters') -ExcludeDirs @('node_modules')
    $relativeFiles = @($files | ForEach-Object { $_.Substring($source.Length + 1) })
    Assert-True ($relativeFiles.Count -eq 5) "Der Quellhash zählt $($relativeFiles.Count) statt 5 Dateien: $($relativeFiles -join ', ')"
    Assert-True (-not ($relativeFiles | Where-Object { $_ -match 'storybook|mock' })) "Der Quellhash enthält die Testwelt: $($relativeFiles -join ', ')"
    $hashBefore = Get-DashboardSourceHash -Source $source -RootFiles @('package.json') -Dirs @('apps', 'packages', 'adapters') -ExcludeDirs @('node_modules')
    Write-Fixture (Join-Path $source 'packages\mock-data\world.ts') 'geaendert'
    $hashAfter = Get-DashboardSourceHash -Source $source -RootFiles @('package.json') -Dirs @('apps', 'packages', 'adapters') -ExcludeDirs @('node_modules')
    Assert-True ($hashBefore -eq $hashAfter) 'Eine Änderung an der Testwelt erzwingt einen neuen Dashboard-Build.'

    # Older installation: test world with a pnpm junction that points at a live package, plus the removed mock-console.
    $victim = Join-Path $target 'packages\ui'
    Write-Fixture (Join-Path $victim 'ui.ts') 'installiert'
    Write-Fixture (Join-Path $target 'apps\storybook\story.ts')
    Write-Fixture (Join-Path $target 'apps\mock-console\src\watch.ts')
    Write-Fixture (Join-Path $target 'packages\mock-data\world.ts')
    New-Item -ItemType Directory -Force (Join-Path $target 'apps\storybook\node_modules\@friday') | Out-Null
    $junction = Join-Path $target 'apps\storybook\node_modules\@friday\ui'
    & cmd.exe /d /c mklink /J "$junction" "$victim" | Out-Null
    Assert-True (Test-Path -LiteralPath (Join-Path $junction 'ui.ts')) 'Die Test-Junction wurde nicht angelegt.'
    Sync-DashboardSource -Source $source -Target $target -RootFiles @('package.json') -Dirs @('apps', 'packages', 'adapters') -ExcludeDirs @('node_modules') -ConfigDirs @() | Out-Null
    foreach ($relative in @('apps\web\page.ts', 'apps\control-api\main.ts', 'packages\ui\ui.ts', 'adapters\hermes\hermes.ts')) {
        Assert-True (Test-Path -LiteralPath (Join-Path $target $relative) -PathType Leaf) "Produktdatei fehlt nach dem Kopieren: $relative"
    }
    foreach ($relative in @('apps\storybook', 'apps\mock-console', 'adapters\mock', 'packages\mock-data')) {
        Assert-True (-not (Test-Path -LiteralPath (Join-Path $target $relative))) "Testwelt liegt nach dem Kopieren in der Installation: $relative"
    }
    Assert-True ((Get-Content -LiteralPath (Join-Path $victim 'ui.ts') -Raw) -in @('installiert', 'x')) 'Das Aufräumen ist der Junction gefolgt und hat ein Produktpaket gelöscht.'
    Assert-True (Test-Path -LiteralPath (Join-Path $victim 'ui.ts') -PathType Leaf) 'Das Aufräumen hat ein Produktpaket gelöscht.'

    # Removal never follows a junction, even when the test folder itself is one.
    $outside = Join-Path $fixture 'Ausserhalb'
    Write-Fixture (Join-Path $outside 'wichtig.txt') 'bleibt'
    New-Item -ItemType Directory -Force (Join-Path $target 'adapters') | Out-Null
    & cmd.exe /d /c mklink /J "$(Join-Path $target 'adapters\mock')" "$outside" | Out-Null
    Remove-DashboardTestOnlyPaths $target
    Assert-True (-not (Test-Path -LiteralPath (Join-Path $target 'adapters\mock'))) 'Die Junction adapters\mock wurde nicht entfernt.'
    Assert-True ((Get-Content -LiteralPath (Join-Path $outside 'wichtig.txt') -Raw) -eq 'bleibt') 'Das Aufräumen hat Dateien hinter einer Junction gelöscht.'

    # --- 2. GitHub updater: sparse download, change list and cleanup
    $updaterFile = Join-Path $installerDir 'scripts\update-dashboard-github.ps1'
    $tokens = $null; $errors = $null
    $ast = [Management.Automation.Language.Parser]::ParseFile($updaterFile, [ref]$tokens, [ref]$errors)
    Assert-True ($errors.Count -eq 0) 'Der Dashboard-Updater hat Parserfehler.'
    $updater = [IO.File]::ReadAllText($updaterFile)
    foreach ($pattern in @('!/apps/storybook/', '!/apps/mock-console/', '!/adapters/mock/', '!/packages/mock-data/')) {
        Assert-True ($updater.Contains("'$pattern'")) "Der Updater lädt die Testwelt herunter: $pattern fehlt im Sparse-Checkout."
    }
    foreach ($assignment in @('testOnlyDirs', 'testOnlyPattern')) {
        $node = $ast.Find({ param($n) $n -is [Management.Automation.Language.AssignmentStatementAst] -and $n.Left.Extent.Text -eq "`$$assignment" }, $true)
        Assert-True ([bool]$node) "Der Updater definiert `$$assignment nicht."
        Invoke-Expression $node.Extent.Text
    }
    foreach ($name in @('Test-SparseSourcePath', 'Remove-DashboardTree', 'Remove-TestOnlyDashboardDirs', 'Assert-NoReparse')) {
        $definition = $ast.Find({ param($n) $n -is [Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq $name }, $true)
        Assert-True ([bool]$definition) "$name fehlt im Updater."
        Invoke-Expression $definition.Extent.Text
    }
    Assert-True (-not (Test-SparseSourcePath 'apps/storybook/package.json')) 'Der Updater lädt Storybook-Dateien.'
    Assert-True (-not (Test-SparseSourcePath 'packages/mock-data/src/world.ts')) 'Der Updater lädt Mock-Daten.'
    Assert-True (-not (Test-SparseSourcePath 'adapters/mock/src/index.ts')) 'Der Updater lädt den Mock-Adapter.'
    Assert-True (Test-SparseSourcePath 'adapters/mock-free/src/index.ts') 'Der Updater blendet ähnlich benannte Produktordner aus.'
    Assert-True (Test-SparseSourcePath 'apps/web/src/page.tsx') 'Der Updater lädt das Dashboard nicht mehr.'
    Assert-True ('packages\mock-data\src\world.ts' -match $testOnlyPattern) 'Die Änderungsliste filtert Mock-Daten nicht.'
    Assert-True (-not ('packages\mock-database\x.ts' -match $testOnlyPattern)) 'Die Änderungsliste filtert ähnlich benannte Produktordner.'
    Assert-True ($updater -match '\$path -match \$testOnlyPattern') 'Die Änderungsliste des Updaters lässt die Testwelt durch.'
    Assert-True ($updater -match 'Remove-TestOnlyDashboardDirs\s+if \(\$changes\.Count -eq 0\)') 'Der Updater räumt die Testwelt nicht vor der Installation auf.'

    $script:dash = Join-Path $fixture 'Installation'
    $script:log = Join-Path $fixture 'update.log'
    Write-Fixture (Join-Path $dash 'packages\ui\ui.ts') 'installiert'
    Write-Fixture (Join-Path $dash 'apps\storybook\story.ts')
    Write-Fixture (Join-Path $dash 'packages\mock-data\world.ts')
    New-Item -ItemType Directory -Force (Join-Path $dash 'apps\storybook\node_modules\@friday') | Out-Null
    & cmd.exe /d /c mklink /J "$(Join-Path $dash 'apps\storybook\node_modules\@friday\ui')" "$(Join-Path $dash 'packages\ui')" | Out-Null
    Remove-TestOnlyDashboardDirs
    Assert-True (-not (Test-Path -LiteralPath (Join-Path $dash 'apps\storybook'))) 'Der Updater entfernt Storybook nicht.'
    Assert-True (-not (Test-Path -LiteralPath (Join-Path $dash 'packages\mock-data'))) 'Der Updater entfernt die Mock-Daten nicht.'
    Assert-True ((Get-Content -LiteralPath (Join-Path $dash 'packages\ui\ui.ts') -Raw) -eq 'installiert') 'Der Updater ist beim Aufräumen einer Junction gefolgt.'
    Assert-True ((Get-Content -LiteralPath $log -Raw) -match 'Testordner entfernt: apps\\storybook') 'Der Updater protokolliert das Aufräumen nicht.'
    # --- 3. Linux installer: rsync leaves the test world out as well
    $linux = [IO.File]::ReadAllText((Join-Path $installerDir 'install-friday-linux.sh'))
    foreach ($pattern in @('/apps/storybook/', '/apps/mock-console/', '/adapters/mock/', '/packages/mock-data/')) {
        Assert-True ($linux.Contains("--exclude='$pattern'")) "Der Linux-Installer kopiert die Testwelt: $pattern"
    }
    Write-Output 'Testwelt nicht in der Installation: PASS'
} finally {
    # rmdir removes the fixture's junctions without following them.
    & cmd.exe /d /c rmdir /s /q "$fixture" 2>$null
}
