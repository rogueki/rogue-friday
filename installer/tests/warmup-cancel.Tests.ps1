# Abbruch im Modell-Warmup: waehrend des Wartens auf Modell- und Sprachdienst darf eine Abbruchbitte nicht
# erst nach dem Timeout wirken. Geprueft wird der echte Wartebaustein gegen einen nicht antwortenden Port.
$ErrorActionPreference = 'Stop'
$installer = Join-Path $PSScriptRoot '..\install-friday.ps1'
$cancelLib = Join-Path $PSScriptRoot '..\lib\installer-cancel.ps1'

$tokens = $null; $errors = $null
$ast = [System.Management.Automation.Language.Parser]::ParseFile($installer, [ref]$tokens, [ref]$errors)
if ($errors.Count) { throw "install-friday.ps1 hat Parserfehler: $($errors[0].Message)" }
$libTokens = $null; $libErrors = $null
$libAst = [System.Management.Automation.Language.Parser]::ParseFile($cancelLib, [ref]$libTokens, [ref]$libErrors)
if ($libErrors.Count) { throw "installer-cancel.ps1 hat Parserfehler: $($libErrors[0].Message)" }

# Dateiname der Abbruchbitte aus der Bibliothek uebernehmen, damit der Test nicht auseinanderlaeuft.
$nameAssignment = $libAst.Find({ param($node) $node -is [System.Management.Automation.Language.AssignmentStatementAst] -and
    $node.Extent.Text -match 'InstallerCancelFileName' }, $true)
if (-not $nameAssignment) { throw 'Der Dateiname der Abbruchbitte fehlt in installer-cancel.ps1.' }
Invoke-Expression $nameAssignment.Extent.Text

foreach ($name in @('Get-InstallerCancelPath', 'Request-InstallerCancel', 'Read-InstallerCancel',
                    'Test-InstallerCancelRequested', 'Clear-InstallerCancel')) {
    $definition = $libAst.Find({ param($node) $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq $name }, $true)
    if (-not $definition) { throw "$name fehlt in installer-cancel.ps1." }
    Invoke-Expression $definition.Extent.Text
}
# Wait-Http delegiert die Abfrage an lib\wait-http.ps1 (503 ist Laden, nicht Fehler) - das Modul muss
# mitgeladen werden, sonst prueft der Test nur einen Aufruf ins Leere.
$waitLib = Join-Path $PSScriptRoot '..\lib\wait-http.ps1'
$waitLibAst = [System.Management.Automation.Language.Parser]::ParseFile($waitLib, [ref]$libTokens, [ref]$libErrors)
if ($libErrors.Count) { throw "wait-http.ps1 hat Parserfehler: $($libErrors[0].Message)" }
foreach ($name in @('Invoke-HttpProbe', 'Wait-HttpEndpoint')) {
    $definition = $waitLibAst.Find({ param($node) $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq $name }, $true)
    if (-not $definition) { throw "$name fehlt in wait-http.ps1." }
    Invoke-Expression $definition.Extent.Text
}
foreach ($name in @('Wait-Http', 'Confirm-NotCancelled')) {
    $definition = $ast.Find({ param($node) $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq $name }, $true)
    if (-not $definition) { throw "$name fehlt." }
    Invoke-Expression $definition.Extent.Text
}

# Statt den Installer zu beenden: merken, dass der Abbruch gegriffen hat.
$script:CancelHits = 0
function Stop-Install([string]$text) { $script:CancelHits++; throw "CANCELLED: $text" }
# Warn() meldet im Installer nur; im Test sammelt es die Meldungen, damit der Grund pruefbar bleibt.
$script:Warnings = New-Object System.Collections.ArrayList
function Warn([string]$text) { [void]$script:Warnings.Add($text) }

$fixture = Join-Path ([IO.Path]::GetTempPath()) ("friday-warmup-" + [guid]::NewGuid().ToString('N').Substring(0, 8))
try {
    New-Item -ItemType Directory -Force -Path (Join-Path $fixture 'run') | Out-Null
    $script:Root = $fixture
    $script:InstallRunId = 'run-warmup-test'

    # Ohne Abbruchbitte: der Wartebaustein laeuft in sein Zeitlimit und meldet false.
    $elapsed = Measure-Command { $script:noCancel = Wait-Http 'http://127.0.0.1:9/' 2 }
    if ($script:noCancel) { throw 'Ein nicht antwortender Port galt als erreichbar.' }
    if ($elapsed.TotalSeconds -gt 20) { throw "Warten ohne Abbruch dauerte $([math]::Round($elapsed.TotalSeconds,1)) s statt rund 2 s." }
    if ($script:Warnings.Count -lt 1) { throw 'Der Wartebaustein meldet den Grund des Fehlschlags nicht.' }
    if (-not ($script:Warnings[$script:Warnings.Count - 1] -match 'nicht erreichbar')) {
        throw "Der Wartebaustein nennt den Grund nicht: $($script:Warnings[$script:Warnings.Count - 1])"
    }

    # Abbruch einer fremden Laufkennung darf diesen Lauf nicht beenden.
    Request-InstallerCancel -Root $fixture -RunId 'fremder-lauf' -Reason 'Test' | Out-Null
    $elapsed = Measure-Command { $script:foreign = Wait-Http 'http://127.0.0.1:9/' 2 }
    if ($script:foreign) { throw 'Fremde Abbruchbitte beendete das Warten als Erfolg.' }
    if ($script:CancelHits -ne 0) { throw 'Eine Abbruchbitte mit fremder Laufkennung wurde befolgt.' }
    if ($elapsed.TotalSeconds -gt 20) { throw 'Warten mit fremder Abbruchbitte lief nicht in sein Zeitlimit.' }

    # Eigene Abbruchbitte: das Warten endet sofort, nicht erst nach dem Zeitlimit.
    Clear-InstallerCancel -Root $fixture -RunId 'fremder-lauf'
    Request-InstallerCancel -Root $fixture -RunId $script:InstallRunId -Reason 'Nutzer hat abgebrochen' | Out-Null
    $elapsed = Measure-Command {
        try { Wait-Http 'http://127.0.0.1:9/' 120 | Out-Null; $script:aborted = $false }
        catch { $script:aborted = $true; $script:message = $_.Exception.Message }
    }
    if (-not $script:aborted) { throw 'Abbruch im Warmup wurde nicht befolgt.' }
    if ($script:CancelHits -ne 1) { throw "Abbruch wurde $($script:CancelHits)x gemeldet statt einmal." }
    if ($elapsed.TotalSeconds -gt 30) { throw "Abbruch wirkte erst nach $([math]::Round($elapsed.TotalSeconds,1)) s statt sofort." }
    if ($script:message -notmatch 'Abbruch angefordert') { throw "Abbruchmeldung nennt den Grund nicht: $($script:message)" }
    if (Test-Path -LiteralPath (Join-Path $fixture 'run\installer.cancel')) { throw 'Abbruchbitte blieb nach der Meldung liegen.' }

    # Die Warteschleife des Sprachdienstes prueft denselben Punkt.
    $voiceLoop = $ast.Find({ param($node) $node -is [System.Management.Automation.Language.ForEachStatementAst] -and
        $node.Extent.Text -match 'listening' }, $true)
    if (-not $voiceLoop) { throw 'Warteschleife des Sprachdienstes nicht gefunden.' }
    if ($voiceLoop.Extent.Text -notmatch 'Confirm-NotCancelled') { throw 'Die Warteschleife des Sprachdienstes ignoriert die Abbruchbitte.' }

    Write-Host 'Abbruch im Warmup: PASS'
} finally {
    $resolved = [IO.Path]::GetFullPath($fixture)
    $tempRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\') + '\'
    if (-not $resolved.StartsWith($tempRoot, [StringComparison]::OrdinalIgnoreCase) -or
        -not ([IO.Path]::GetFileName($resolved)).StartsWith('friday-warmup-')) { throw "Unsicherer Testpfad: $resolved" }
    if (Test-Path -LiteralPath $resolved) { Remove-Item -LiteralPath $resolved -Recurse -Force }
}