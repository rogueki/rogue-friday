$ErrorActionPreference = 'Stop'
# Both voice updaters copy fixed file lists; a typo or a missing entry only shows up on a user's machine when the update
# aborts (Assert-Ordinary) or leaves a module behind. Every entry must exist in the repo and both lists must agree.
$repo = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))

function Get-ScriptAst([string]$path) {
    $tokens = $null
    $errors = $null
    $ast = [Management.Automation.Language.Parser]::ParseFile($path, [ref]$tokens, [ref]$errors)
    if ($errors.Count) { throw "Parserfehler in ${path}: $($errors[0].Message)" }
    return $ast
}

$personaAst = Get-ScriptAst (Join-Path $PSScriptRoot '..\scripts\update-voice-personas.ps1')
$assignment = $personaAst.Find({ param($node) $node -is [Management.Automation.Language.AssignmentStatementAst] -and $node.Left.Extent.Text -eq '$files' }, $true)
if (-not $assignment) { throw '$files fehlt in update-voice-personas.ps1' }
Invoke-Expression $assignment.Extent.Text

$dashboardAst = Get-ScriptAst (Join-Path $PSScriptRoot '..\scripts\update-dashboard-github.ps1')
$definition = $dashboardAst.Find({ param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq 'Get-VoiceSourcePaths' }, $true)
if (-not $definition) { throw 'Get-VoiceSourcePaths fehlt' }
Invoke-Expression $definition.Extent.Text

$failures = @()
$personaPaths = @(foreach ($relative in $files) {
    if ($relative -match '[\x00-\x1f]') { $failures += "Steuerzeichen im Eintrag: $([Text.RegularExpressions.Regex]::Escape($relative))"; continue }
    $normalized = if ($relative -like 'voice\*') { 'installer/' + ($relative -replace '\\', '/') } else { $relative -replace '\\', '/' }
    if (-not (Test-Path -LiteralPath (Join-Path $repo $normalized) -PathType Leaf)) { $failures += "update-voice-personas.ps1: $relative fehlt im Repo" }
    $normalized
})
$dashboardPaths = @(Get-VoiceSourcePaths)
foreach ($path in $dashboardPaths) {
    if ($path -match '[\x00-\x1f]') { $failures += "Steuerzeichen im Eintrag: $([Text.RegularExpressions.Regex]::Escape($path))"; continue }
    if (-not (Test-Path -LiteralPath (Join-Path $repo $path) -PathType Leaf)) { $failures += "update-dashboard-github.ps1: $path fehlt im Repo" }
}
foreach ($difference in (Compare-Object ($personaPaths | Sort-Object -Unique) ($dashboardPaths | Sort-Object -Unique))) {
    $side = if ($difference.SideIndicator -eq '<=') { 'nur in update-voice-personas.ps1' } else { 'nur in update-dashboard-github.ps1' }
    $failures += "$($difference.InputObject) $side"
}
if ($failures.Count) { throw ("Voice-Update-Dateilisten fehlerhaft:`n" + ($failures -join "`n")) }
Write-Output "Voice-Update-Dateilisten: $($personaPaths.Count) Einträge geprüft"
