# Prueft, dass die Sperrdatei des Installers einen frischen Zielordner nicht als "nicht leer" abweist.
# Regression aus INS-06: die Sperre wird vor der Leerpruefung angelegt und haette jede frische
# Installation mit eigenem Root unmoeglich gemacht.
$ErrorActionPreference = 'Stop'
$installer = Join-Path $PSScriptRoot '..\install-friday.ps1'
$tokens = $null; $errors = $null
$ast = [System.Management.Automation.Language.Parser]::ParseFile($installer, [ref]$tokens, [ref]$errors)
if ($errors.Count) { throw "install-friday.ps1 hat Parserfehler: $($errors[0].Message)" }
$definition = $ast.Find({ param($node) $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq 'Test-FreshRootEmpty' }, $true)
if (-not $definition) { throw 'Test-FreshRootEmpty fehlt.' }
Invoke-Expression $definition.Extent.Text

$fixture = Join-Path ([IO.Path]::GetTempPath()) ("friday fresh-root-" + [guid]::NewGuid().ToString('N').Substring(0, 8))
try {
    New-Item -ItemType Directory -Force -Path $fixture | Out-Null

    # Nicht vorhandener Ordner gilt als leer (die Installation legt ihn selbst an).
    if (-not (Test-FreshRootEmpty (Join-Path $fixture 'gibt-es-nicht'))) { throw 'Fehlender Ordner wurde als belegt gemeldet.' }

    # Wirklich leer.
    $empty = Join-Path $fixture 'leer'
    New-Item -ItemType Directory -Force -Path $empty | Out-Null
    if (-not (Test-FreshRootEmpty $empty)) { throw 'Leerer Ordner wurde als belegt gemeldet.' }

    # Der eigentliche Regressionsfall: nur die eigene Sperrdatei liegt in run\.
    $withLock = Join-Path $fixture 'mit sperre'
    New-Item -ItemType Directory -Force -Path (Join-Path $withLock 'run') | Out-Null
    Set-Content -LiteralPath (Join-Path $withLock 'run\installer.lock.json') -Value '{"pid":1}' -Encoding ASCII
    if (-not (Test-FreshRootEmpty $withLock)) { throw 'Eigene Sperrdatei wurde als fremder Inhalt gewertet; frische Installation mit eigenem Root waere unmoeglich.' }

    # Alles andere bleibt belegt: fremde Datei in run\, fremde Datei im Root, run als Datei.
    Copy-Item -LiteralPath (Join-Path $withLock 'run\installer.lock.json') -Destination (Join-Path $withLock 'run\fremd.txt')
    if (Test-FreshRootEmpty $withLock) { throw 'Fremde Datei in run\ wurde ignoriert.' }
    Remove-Item -LiteralPath (Join-Path $withLock 'run\fremd.txt') -Force

    $withFile = Join-Path $fixture 'mit datei'
    New-Item -ItemType Directory -Force -Path $withFile | Out-Null
    Set-Content -LiteralPath (Join-Path $withFile 'notes.txt') -Value 'x' -Encoding ASCII
    if (Test-FreshRootEmpty $withFile) { throw 'Fremde Datei im Root wurde ignoriert.' }

    $runIsFile = Join-Path $fixture 'run ist datei'
    New-Item -ItemType Directory -Force -Path $runIsFile | Out-Null
    Set-Content -LiteralPath (Join-Path $runIsFile 'run') -Value 'x' -Encoding ASCII
    if (Test-FreshRootEmpty $runIsFile) { throw 'Datei namens run wurde ignorieret.' }

    # Der echte Check muss die Funktion benutzen, nicht wieder selbst zaehlen.
    $body = Get-Content -LiteralPath $installer -Raw -Encoding UTF8
    if ($body -notmatch 'not \(Test-FreshRootEmpty \$Root\)') { throw 'Leerpruefung nutzt Test-FreshRootEmpty nicht.' }

    # Am echten Einstiegspunkt: ein leerer, eigener Zielordner darf nicht an der Leerpruefung scheitern.
    # Der Lauf endet an der naechsten Pruefung (Ablageort innerhalb des Zielordners).
    $e2eRoot = Join-Path $fixture 'Ziel ordner ü'
    New-Item -ItemType Directory -Force -Path $e2eRoot | Out-Null
    $stdout = Join-Path $fixture 'e2e.out.txt'
    $stderr = Join-Path $fixture 'e2e.err.txt'
    & cmd.exe /c "powershell.exe -NoProfile -ExecutionPolicy Bypass -File `"$installer`" -InstallRoot `"$e2eRoot`" -DistroName `"FRIDAY-Test`" -DistroLocation `"$e2eRoot\distro`" < nul > `"$stdout`" 2> `"$stderr`""
    $code = $LASTEXITCODE
    $output = Get-Content -LiteralPath $stdout -Raw -Encoding UTF8 -ErrorAction SilentlyContinue
    if ($code -ne 1) { throw "Frischer Lauf endete mit Code $code statt 1. Ausgabe: $output $(Get-Content -LiteralPath $stderr -Raw -ErrorAction SilentlyContinue)" }
    if ($output -match 'nicht leer') { throw "Frischer Zielordner wurde als belegt abgewiesen: $output" }
    if ($output -notmatch 'ueberlappen') { throw "Frischer Lauf erreichte die erwartete Pruefung nicht: $output" }

    Write-Host 'Frische Wurzel trotz Sperrdatei: PASS'
} finally {
    $resolved = [IO.Path]::GetFullPath($fixture)
    $tempRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\') + '\'
    if (-not $resolved.StartsWith($tempRoot, [StringComparison]::OrdinalIgnoreCase) -or
        -not ([IO.Path]::GetFileName($resolved)).StartsWith('friday fresh-root-')) { throw "Unsicherer Testpfad: $resolved" }
    if (Test-Path -LiteralPath $resolved) { Remove-Item -LiteralPath $resolved -Recurse -Force }
}