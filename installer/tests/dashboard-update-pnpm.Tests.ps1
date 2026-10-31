$ErrorActionPreference = 'Stop'
$scriptFile = Join-Path $PSScriptRoot '..\scripts\update-dashboard-github.ps1'
$tokens = $null
$errors = $null
$ast = [Management.Automation.Language.Parser]::ParseFile($scriptFile, [ref]$tokens, [ref]$errors)
if ($errors.Count) { throw "Dashboard-Updater Parserfehler: $($errors[0].Message)" }
foreach ($name in @('Invoke-Pnpm', 'Test-DependencyInstallNeeded')) {
    $definition = $ast.Find({ param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq $name }, $true)
    if (-not $definition) { throw "$name fehlt" }
    Invoke-Expression $definition.Extent.Text
}
$fixture = Join-Path ([IO.Path]::GetTempPath()) ('friday updater pnpm ' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $fixture | Out-Null
$previousPath = $env:PATH
try {
    $script:log = Join-Path $fixture 'update.log'
    # Stand-in pnpm: warnings on stderr, exit code from the first argument.
    [IO.File]::WriteAllText((Join-Path $fixture 'pnpm.cmd'), "@echo off`r`necho WARN deprecated package 1>&2`r`necho done %1`r`nexit /b %1`r`n")
    $env:PATH = "$fixture;$previousPath"
    $exit = Invoke-Pnpm @('0')
    if ($exit -ne 0) { throw "pnpm-Warnung auf stderr wurde als Fehler gewertet (Exit $exit)." }
    $logged = [IO.File]::ReadAllText($log)
    if ($logged -notmatch 'WARN deprecated package' -or $logged -notmatch 'done 0') { throw 'pnpm-Ausgabe fehlt im Update-Log.' }
    if ((Invoke-Pnpm @('3')) -ne 3) { throw 'pnpm-Fehlercode wurde nicht weitergegeben.' }
    if ($ErrorActionPreference -ne 'Stop') { throw 'ErrorActionPreference wurde nicht wiederhergestellt.' }

    $change = { param($path) [pscustomobject]@{ Kind = 'M'; Path = $path } }
    foreach ($path in @('package.json', 'pnpm-lock.yaml', 'apps\web\package.json', 'pnpm-workspace.yaml', '.npmrc')) {
        if (-not (Test-DependencyInstallNeeded @((& $change 'apps\web\src\page.tsx'), (& $change $path)))) { throw "Abhängigkeiten werden bei $path nicht neu installiert." }
    }
    foreach ($path in @('apps\web\src\page.tsx', 'packages\contracts\schemas\x.json', 'apps\web\package.json.bak')) {
        if (Test-DependencyInstallNeeded @((& $change $path))) { throw "Unnötige Neuinstallation bei $path." }
    }
    if (Test-DependencyInstallNeeded @()) { throw 'Leere Änderungsliste löst eine Neuinstallation aus.' }
    $source = [IO.File]::ReadAllText($scriptFile)
    if ($source -match '& pnpm\.cmd install|& pnpm\.cmd build') { throw 'pnpm wird noch direkt ohne Invoke-Pnpm aufgerufen.' }
    Write-Output 'Dashboard-Update-pnpm: PASS'
} finally {
    $env:PATH = $previousPath
    $resolvedFixture = [IO.Path]::GetFullPath($fixture)
    $tempRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath())
    if ($resolvedFixture.StartsWith($tempRoot, [StringComparison]::OrdinalIgnoreCase)) { Remove-Item -LiteralPath $fixture -Recurse -Force }
}
