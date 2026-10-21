# Prueft das atomare Schreiben des Installationszustands: kein halbe JSON-Datei, kein Rest, sichere Fortsetzung.
$ErrorActionPreference = 'Stop'
$installer = Join-Path $PSScriptRoot '..\install-friday.ps1'
$tokens = $null; $errors = $null
$ast = [System.Management.Automation.Language.Parser]::ParseFile($installer, [ref]$tokens, [ref]$errors)
if ($errors.Count) { throw "install-friday.ps1 hat Parserfehler: $($errors[0].Message)" }
$definition = $ast.Find({ param($node) $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq 'Save-State' }, $true)
if (-not $definition) { throw 'Save-State fehlt.' }
Invoke-Expression $definition.Extent.Text

$fixture = Join-Path ([IO.Path]::GetTempPath()) ("friday-state-" + [guid]::NewGuid().ToString('N'))
try {
    $script:StateFile = Join-Path $fixture 'nested\install-state.json'
    $script:State = [ordered]@{ done = @('preflight', 'files'); voice_choice = 'classic'; model_name = 'test-model'; nested = @{ a = 1 } }
    Save-State
    if (-not (Test-Path -LiteralPath $script:StateFile -PathType Leaf)) { throw 'Zustand wurde nicht angelegt.' }
    $loaded = Get-Content -LiteralPath $script:StateFile -Raw -Encoding UTF8 | ConvertFrom-Json
    if (@($loaded.done) -notcontains 'files' -or $loaded.voice_choice -ne 'classic' -or $loaded.nested.a -ne 1) {
        throw 'Zustand wurde nicht vollstaendig gespeichert.'
    }
    if (Test-Path -LiteralPath "$($script:StateFile).tmp") { throw 'Temporaerdatei blieb liegen.' }

    $script:State.done = @('preflight', 'files', 'wslfeature')
    $script:State.voice_choice = 'friday-female'
    Save-State
    $again = Get-Content -LiteralPath $script:StateFile -Raw -Encoding UTF8 | ConvertFrom-Json
    if (@($again.done) -notcontains 'wslfeature' -or $again.voice_choice -ne 'friday-female') { throw 'Zweites Speichern hat den Zustand nicht ersetzt.' }
    if (@($again.done).Count -ne 3) { throw 'Doppelte oder fehlende Schritte im Zustand.' }
    if (Test-Path -LiteralPath "$($script:StateFile).tmp") { throw 'Temporaerdatei blieb nach dem Ersetzen liegen.' }
    if (@(Get-ChildItem -LiteralPath (Split-Path -Parent $script:StateFile)).Count -ne 1) { throw 'Es liegen mehrere Zustandsdateien herum.' }
    Write-Host 'Atomarer Installationszustand: PASS'
} finally {
    $resolved = [IO.Path]::GetFullPath($fixture)
    $tempRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\') + '\'
    if (-not $resolved.StartsWith($tempRoot, [StringComparison]::OrdinalIgnoreCase) -or
        -not ([IO.Path]::GetFileName($resolved)).StartsWith('friday-state-')) { throw "Unsicherer Testpfad: $resolved" }
    if (Test-Path -LiteralPath $resolved) { Remove-Item -LiteralPath $resolved -Recurse -Force }
}