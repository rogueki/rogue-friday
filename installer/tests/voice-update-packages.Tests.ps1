$ErrorActionPreference = 'Stop'
$scriptFile = Join-Path $PSScriptRoot '..\scripts\update-voice-personas.ps1'
$tokens = $null
$errors = $null
$ast = [Management.Automation.Language.Parser]::ParseFile($scriptFile, [ref]$tokens, [ref]$errors)
if ($errors.Count) { throw "Voice-Update-Helfer Parserfehler: $($errors[0].Message)" }
foreach ($name in @('Invoke-NativeCaptured', 'Install-MissingVoicePackages')) {
    $definition = $ast.Find({ param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq $name }, $true)
    if (-not $definition) { throw "$name fehlt" }
    Invoke-Expression $definition.Extent.Text
}
$python = (Get-Command python -ErrorAction Stop).Source
$missingSpec = Join-Path ([IO.Path]::GetTempPath()) ('friday-missing-package-' + [guid]::NewGuid().ToString('N'))
$results = @(Install-MissingVoicePackages $python @(
    @{ Module = 'json'; Spec = 'json' },
    @{ Module = 'friday_missing_module'; Spec = $missingSpec }
))
if ($results.Count -ne 2) { throw "Erwartet zwei Ergebnisse, erhalten $($results.Count)." }
if ($results[0].name -ne 'json' -or $results[0].result -ne 'present') { throw 'Vorhandenes Paket wurde nicht als vorhanden erkannt.' }
if ($results[1].name -ne 'friday_missing_module' -or $results[1].result -ne 'failed') { throw 'Fehlgeschlagene Installation wurde nicht gemeldet.' }
$source = [IO.File]::ReadAllText($scriptFile)
if ($source -notmatch "Module='websockets'; Spec='websockets>=15,<17'") { throw 'websockets fehlt in den Update-Paketen.' }
$installer = [IO.File]::ReadAllText((Join-Path $PSScriptRoot '..\install-friday.ps1'))
if (([regex]::Matches($installer, "'websockets>=15,<17'")).Count -ne 2) { throw 'Installer und Update nennen unterschiedliche websockets-Versionen.' }
Write-Output 'Voice-Update-Pakete: PASS'
