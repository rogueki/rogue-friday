# Prueft die vom Installer erzeugte adapters.yaml: jede frisch installierte Kategorie mit Hermes-Anbieter
# ist eingetragen (Automationen fehlten frueher und standen auf jeder Neuinstallation auf "nicht eingerichtet")
# und jeder eingetragene Anbieter steht in der allowlist.
$ErrorActionPreference = 'Stop'
$installer = Join-Path $PSScriptRoot '..\install-friday.ps1'
$tokens = $null; $errors = $null
$ast = [System.Management.Automation.Language.Parser]::ParseFile($installer, [ref]$tokens, [ref]$errors)
if ($errors.Count) { throw "install-friday.ps1 hat Parserfehler: $($errors[0].Message)" }
$assignment = $ast.Find({ param($node) $node -is [System.Management.Automation.Language.AssignmentStatementAst] -and
    $node.Left.Extent.Text -eq '$adaptersYaml' }, $true)
if (-not $assignment) { throw 'Die Vorlage $adaptersYaml fehlt.' }
$template = $assignment.Right.Extent.Text.Replace("`r`n", "`n")

$allowlist = [regex]::Match($template, '(?ms)^allowlist:\n(.*?)\n\n').Groups[1].Value
$allowed = @([regex]::Matches($allowlist, '(?m)^  ([a-z0-9-]+):') | ForEach-Object { $_.Groups[1].Value })
$adapters = $template.Substring($template.IndexOf("`nadapters:`n"))
$categories = @([regex]::Matches($adapters, '(?m)^  ([a-z]+):\n    provider: ([a-z0-9-]+)') | ForEach-Object {
    [pscustomobject]@{ Category = $_.Groups[1].Value; Provider = $_.Groups[2].Value } })

foreach ($required in @('tasks', 'activity', 'agents', 'automations', 'voice', 'system')) {
    if (-not ($categories | Where-Object Category -eq $required)) { throw "Kategorie '$required' fehlt in der Installer-Vorlage." }
}
foreach ($entry in $categories) {
    if ($allowed -notcontains $entry.Provider) { throw "Anbieter '$($entry.Provider)' ($($entry.Category)) steht nicht in der allowlist." }
}
if (($categories | Where-Object Category -eq 'automations').Provider -ne 'hermes-automations') { throw 'Automationen nutzen nicht hermes-automations.' }
if ($adapters -notmatch '(?ms)^  automations:\n(    .*\n)*?      dashboardBaseUrl: http://127\.0\.0\.1:\$\(\$Ports\.Dashboard\)\n      dashboardAuth: scrape') {
    throw 'Automationen zeigen nicht auf das Hermes-Dashboard der Installation.'
}
Write-Host 'Installer-Adaptervorlage vollstaendig: PASS'
