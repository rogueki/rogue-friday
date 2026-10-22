# Static contract test for the installer I/O layer. Parses only; no installation, no processes.
# Proves: every answer/secret the backend asks for exists in the GUI transport, and no prompt can block a GUI run.
$ErrorActionPreference = 'Stop'
$backendPath = Join-Path $PSScriptRoot '..\install-friday.ps1'
$guiPath = Join-Path $PSScriptRoot '..\install-friday-gui.ps1'

$tokens = $null; $errors = $null
$backendAst = [Management.Automation.Language.Parser]::ParseFile((Resolve-Path $backendPath).Path, [ref]$tokens, [ref]$errors)
if ($errors.Count) { throw "Backend parse error: $($errors[0].Message)" }
$tokens = $null; $errors = $null
$guiAst = [Management.Automation.Language.Parser]::ParseFile((Resolve-Path $guiPath).Path, [ref]$tokens, [ref]$errors)
if ($errors.Count) { throw "GUI parse error: $($errors[0].Message)" }

# Ast.FindAll runs its filter in a separate session state, so outer variables are filtered afterwards.
$allNodes = @($backendAst.FindAll({ param($node) $true }, $true))
$allGuiNodes = @($guiAst.FindAll({ param($node) $true }, $true))

function Get-GuiKeys([string]$helper) {
    $used = New-Object 'System.Collections.Generic.HashSet[string]'
    $calls = @($allNodes | Where-Object {
        $_ -is [Management.Automation.Language.CommandAst] -and $_.GetCommandName() -eq $helper
    })
    foreach ($call in $calls) {
        $argument = $call.CommandElements[1]
        if ($argument -is [Management.Automation.Language.StringConstantExpressionAst]) { [void]$used.Add($argument.Value); continue }
        # Ask/Choose map the question text to a key at run time; their mapped literals are audited below.
        $owner = $call
        $dynamicAllowed = $false
        while ($owner.Parent) {
            $owner = $owner.Parent
            if ($owner -is [Management.Automation.Language.FunctionDefinitionAst]) {
                $dynamicAllowed = $owner.Name -in @('Ask', 'Choose', 'YesNo')
                break
            }
        }
        if (-not $dynamicAllowed) { throw "$helper called without a literal key: $($call.Extent.Text)" }
    }
    return $used
}

function Get-MappedKeys([string]$functionName) {
    $keys = New-Object 'System.Collections.Generic.HashSet[string]'
    $definition = $guiAst.Find({
        param($node)
        $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq $functionName
    }, $true)
    if (-not $definition) { return $keys }
    foreach ($node in @($definition.FindAll({ param($n) $n -is [Management.Automation.Language.StringConstantExpressionAst] }, $true))) {
        if ($node.Value -like '^*') { continue }
        [void]$keys.Add($node.Value)
    }
    return $keys
}

function Get-HashtableKeys([string]$variable) {
    $keys = New-Object 'System.Collections.Generic.HashSet[string]'
    $assignments = @($allGuiNodes | Where-Object {
        $_ -is [Management.Automation.Language.AssignmentStatementAst] -and
        $_.Left -is [Management.Automation.Language.VariableExpressionAst] -and
        $_.Left.VariablePath.UserPath -eq $variable
    })
    $tables = @()
    foreach ($assignment in $assignments) {
        $table = $assignment.Right.Find({ param($node) $node -is [Management.Automation.Language.HashtableAst] }, $false)
        if ($table) { $tables += $table }
    }
    if ($tables.Count -ne 1) { throw "GUI has $($tables.Count) hashtable definitions of `$$variable" }
    foreach ($pair in $tables[0].KeyValuePairs) {
        $key = $pair.Item1
        if ($key -isnot [Management.Automation.Language.StringConstantExpressionAst]) {
            throw "Non-literal key inside `$$variable : $($key.Extent.Text)"
        }
        [void]$keys.Add($key.Value)
    }
    return $keys
}

$answers = Get-HashtableKeys 'answers'
$secrets = Get-HashtableKeys 'secrets'
if ($answers.Count -lt 20 -or $secrets.Count -lt 6) {
    throw "GUI transport looks truncated: $($answers.Count) answers, $($secrets.Count) secrets"
}

foreach ($key in Get-GuiKeys 'Gui-Answer') {
    if (-not $answers.Contains($key)) { throw "Backend asks Gui-Answer '$key' but the GUI never sends it." }
}
foreach ($functionName in @('Ask', 'Choose')) {
    foreach ($key in Get-MappedKeys $functionName) {
        if (-not $answers.Contains($key)) { throw "$functionName maps to '$key' but the GUI never sends it." }
    }
}
foreach ($key in Get-GuiKeys 'Gui-Secret') {
    if (-not $secrets.Contains($key)) { throw "Backend asks Gui-Secret '$key' but the GUI never sends it." }
}

$prompts = @($allNodes | Where-Object {
    $_ -is [Management.Automation.Language.CommandAst] -and $_.GetCommandName() -eq 'Read-Host'
})
$guarded = 0
foreach ($prompt in $prompts) {
    $node = $prompt
    $covered = $false
    while ($node.Parent) {
        $node = $node.Parent
        if ($node -is [Management.Automation.Language.FunctionDefinitionAst]) {
            if ($node.Name -in @('Ask', 'Choose', 'YesNo')) { $covered = $true }
            break
        }
        if ($node.Extent.Text -match '\$GuiMode') { $covered = $true; break }
    }
    if (-not $covered) { throw "Unguarded Read-Host at line $($prompt.Extent.StartLineNumber): $($prompt.Extent.Text)" }
    $guarded++
}
if ($guarded -ne $prompts.Count) { throw "Prompt audit mismatch: $guarded of $($prompts.Count)" }

# Interactive python prompts are limited to the enrollment recording, which runs with a human present by design.
$pythonPrompts = @()
foreach ($file in Get-ChildItem -Path (Join-Path $PSScriptRoot '..') -Recurse -Filter '*.py') {
    $line = 0
    foreach ($content in Get-Content -LiteralPath $file.FullName) {
        $line++
        if ($content -match '^\s*[^#]*\binput\(') { $pythonPrompts += ('{0}:{1}' -f $file.Name, $line) }
    }
}
# Nur die Aufnahme fragt auf der Konsole (Rueckfall ohne Assistent): Zeilen absichtlich fest benannt.
$allowedPython = @('enroll_record.py:66', 'enroll_record.py:276')
foreach ($entry in $pythonPrompts) {
    if ($entry -notin $allowedPython) { throw "Unexpected interactive python prompt: $entry" }
}

Write-Output ("Installer I/O contract: {0} answers, {1} secrets, {2} guarded prompts, python prompts {3}: PASS" -f
    $answers.Count, $secrets.Count, $guarded, ($pythonPrompts -join ', '))