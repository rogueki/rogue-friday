$ErrorActionPreference = 'Stop'
$scriptFile = Join-Path $PSScriptRoot '..\scripts\update-dashboard-github.ps1'
$tokens = $null
$errors = $null
$ast = [System.Management.Automation.Language.Parser]::ParseFile($scriptFile, [ref]$tokens, [ref]$errors)
if ($errors.Count) { throw "Updater hat PowerShell-Parserfehler: $($errors[0].Message)" }
foreach ($name in @('Write-UpdateState', 'Set-UpdatePhase', 'Set-UpdateToolPath')) {
    $definition = $ast.Find({ param($node) $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq $name }, $true)
    if (-not $definition) { throw "$name fehlt" }
    Invoke-Expression $definition.Extent.Text
}
$fixture = Join-Path ([IO.Path]::GetTempPath()) ("friday updater progress " + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $fixture | Out-Null
try {
    $script:progressFile = Join-Path $fixture 'dashboard-update-progress.json'
    $script:RunId = 'a' * 32
    $script:ExpectedCommit = 'b' * 40
    $script:runStartedAt = (Get-Date).ToUniversalTime().ToString('o')
    $script:processStartedAt = (Get-Process -Id $PID).StartTime.ToUniversalTime().ToString('o')
    $script:step = 0
    Set-UpdatePhase 1 'download' 'GitHub-Quellstand wird geladen.'
    $running = Get-Content $progressFile -Raw | ConvertFrom-Json
    if ($running.runId -cne $RunId -or $running.targetCommit -cne $ExpectedCommit -or
        $running.phase -cne 'download' -or $running.step -ne 1 -or $running.state -cne 'running') {
        throw 'Startfortschritt ist falsch.'
    }
    Set-UpdatePhase 7 'health' 'Dashboard startet neu.'
    Write-UpdateState 'failed' 'Rollback konnte nicht bestätigt werden.' 'failed'
    $failed = Get-Content $progressFile -Raw | ConvertFrom-Json
    if ($failed.runId -cne $RunId -or $failed.phase -cne 'failed' -or
        $failed.state -cne 'failed' -or $failed.step -ne 7) { throw 'Fehlerstatus ist falsch.' }
    if (Get-ChildItem -LiteralPath $fixture -Filter '*.tmp') { throw 'Temporäre Statusdatei blieb liegen.' }
    $node = Get-Command node.exe -ErrorAction Stop | Select-Object -First 1
    $pnpm = Get-Command pnpm.cmd -ErrorAction Stop | Select-Object -First 1
    $originalPath = $env:Path
    try {
        $env:Path = '"' + (Split-Path $node.Source) + '";"' + (Split-Path $pnpm.Source) + '"'
        Set-UpdateToolPath
        if ($env:Path -match '"') { throw 'Zitierte PATH-Eintraege blieben erhalten.' }
        & cmd.exe /d /c 'pnpm --version >nul 2>&1'
        if ($LASTEXITCODE -ne 0) { throw 'pnpm ist fuer Build-Skripte nicht aufloesbar.' }
    } finally { $env:Path = $originalPath }
    Write-Output 'Dashboard-Update-Fortschritt: PASS'
} finally {
    $resolvedFixture = [IO.Path]::GetFullPath($fixture)
    $tempRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath())
    if (-not $resolvedFixture.StartsWith($tempRoot, [StringComparison]::OrdinalIgnoreCase)) {
        throw 'Temporärer Testpfad liegt außerhalb des TEMP-Verzeichnisses.'
    }
    Remove-Item -LiteralPath $fixture -Recurse -Force
}
