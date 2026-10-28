$ErrorActionPreference = 'Stop'
$helper = Join-Path (Split-Path $PSScriptRoot -Parent) 'scripts\update-voice-personas.ps1'
$tokens = $null
$parseErrors = $null
$tree = [Management.Automation.Language.Parser]::ParseFile($helper, [ref]$tokens, [ref]$parseErrors)
if ($parseErrors.Count -gt 0) { throw 'Voice helper does not parse.' }
$definition = $tree.Find({ param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq 'Invoke-NativeCaptured' }, $false)
if (-not $definition) { throw 'Native capture function is missing.' }
. ([scriptblock]::Create($definition.Extent.Text))
$native = (Get-Command powershell.exe).Source
$warmup = Invoke-NativeCaptured $native @('-NoProfile', '-Command', "[Console]::Error.WriteLine('warming'); exit 0")
if ($warmup.ExitCode -ne 0 -or (($warmup.Lines -join ' ') -notmatch 'warming')) { throw 'Expected stderr caused an early failure.' }
$failure = Invoke-NativeCaptured $native @('-NoProfile', '-Command', "[Console]::Error.WriteLine('failed'); exit 7")
if ($failure.ExitCode -ne 7 -or (($failure.Lines -join ' ') -notmatch 'failed')) { throw 'Native exit failure was lost.' }
Write-Output 'Native stderr capture: success with stderr and exit 7 verified.'
