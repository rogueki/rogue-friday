# Kooperativer Abbruch: die GUI bittet den Lauf um Halt, der Installer prueft an jeder Schrittgrenze
# und vor jedem Unterprozess. Geprueft werden Modulverhalten, die Verdrahtung im Installer und die
# Abbruchfunktion selbst am echten Einstiegspunkt.
$ErrorActionPreference = 'Stop'
$installer = Join-Path $PSScriptRoot '..\install-friday.ps1'
$gui = Join-Path $PSScriptRoot '..\install-friday-gui.ps1'
$lib = Join-Path $PSScriptRoot '..\lib\installer-cancel.ps1'
. $lib

$fixture = Join-Path ([IO.Path]::GetTempPath()) ("friday cancel-" + [guid]::NewGuid().ToString('N').Substring(0, 8))
try {
    New-Item -ItemType Directory -Force -Path $fixture | Out-Null
    $root = Join-Path $fixture 'Ziel ordner ü'
    New-Item -ItemType Directory -Force -Path $root | Out-Null

    # --- Modulverhalten
    if ((Get-InstallerCancelPath $root) -ne (Join-Path $root 'run\installer.cancel')) { throw 'Abbruchdatei liegt nicht unter run\installer.cancel.' }
    if (Test-InstallerCancelRequested -Root $root -RunId 'lauf-1') { throw 'Ohne Datei wurde ein Abbruch gemeldet.' }
    if (Request-InstallerCancel -Root $root -RunId '' -Reason 'ohne') { throw 'Ohne Laufkennung wurde eine Abbruchdatei geschrieben.' }
    $written = Request-InstallerCancel -Root $root -RunId 'lauf-1' -Reason 'Testfall'
    if (-not $written -or -not (Test-Path -LiteralPath $written)) { throw 'Abbruchbitte wurde nicht geschrieben.' }
    if (-not (Test-InstallerCancelRequested -Root $root -RunId 'lauf-1')) { throw 'Eigene Abbruchbitte wurde nicht erkannt.' }
    if (Test-InstallerCancelRequested -Root $root -RunId 'lauf-2') { throw 'Fremde Laufkennung wurde als eigener Abbruch gewertet.' }
    if (Test-InstallerCancelRequested -Root $root -RunId '') { throw 'Leere Laufkennung wurde als Abbruch gewertet.' }
    Clear-InstallerCancel -Root $root -RunId 'lauf-2'
    if (-not (Test-Path -LiteralPath $written)) { throw 'Eine fremde Abbruchbitte wurde von Clear-InstallerCancel entfernt.' }
    Clear-InstallerCancel -Root $root -RunId 'lauf-1'
    if (Test-Path -LiteralPath $written) { throw 'Eigene Abbruchbitte wurde nicht entfernt.' }

    # --- Confirm-NotCancelled verhaelt sich wie im Installer (Funktion per AST entnommen)
    $tokens = $null; $errors = $null
    $ast = [System.Management.Automation.Language.Parser]::ParseFile($installer, [ref]$tokens, [ref]$errors)
    if ($errors.Count) { throw "install-friday.ps1 hat Parserfehler: $($errors[0].Message)" }
    $definition = $ast.Find({ param($node) $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq 'Confirm-NotCancelled' }, $true)
    if (-not $definition) { throw 'Confirm-NotCancelled fehlt im Installer.' }
    Invoke-Expression $definition.Extent.Text
    $script:Root = $root
    $script:InstallRunId = 'lauf-3'
    $script:stopCalls = New-Object System.Collections.Generic.List[string]
    function Stop-Install($text) { $script:stopCalls.Add($text) }

    Confirm-NotCancelled
    if ($script:stopCalls.Count -ne 0) { throw 'Ohne Abbruchbitte wurde abgebrochen.' }
    [void](Request-InstallerCancel -Root $root -RunId 'lauf-9' -Reason 'fremd')
    Confirm-NotCancelled
    if ($script:stopCalls.Count -ne 0) { throw 'Fremde Abbruchbitte hat den Lauf beendet.' }
    Clear-InstallerCancel -Root $root
    [void](Request-InstallerCancel -Root $root -RunId 'lauf-3' -Reason 'Nutzer hat abgebrochen')
    Confirm-NotCancelled
    if ($script:stopCalls.Count -ne 1) { throw "Eigene Abbruchbitte hat nicht abgebrochen (Aufrufe: $($script:stopCalls.Count))." }
    if ($script:stopCalls[0] -notmatch 'Abbruch angefordert' -or $script:stopCalls[0] -notmatch 'Nutzer hat abgebrochen') {
        throw "Abbruchmeldung nennt Grund nicht: $($script:stopCalls[0])"
    }
    if (Test-Path -LiteralPath (Get-InstallerCancelPath $root)) { throw 'Abbruchbitte blieb nach dem Abbruch liegen.' }

    # --- Verdrahtung im Installer: jede Schrittgrenze und jeder Unterprozess prueft die Bitte
    $body = Get-Content -LiteralPath $installer -Raw -Encoding UTF8
    if ($body -notmatch "lib\\installer-cancel\.ps1") { throw 'Abbruchmodul wird nicht eingebunden.' }
    $stepBlocks = [regex]::Matches($body, "if \(-not \(IsDone '([a-z]+)'\)[^\r\n]*\{\r\n    (Enter-Step '([a-z]+)'|Confirm-NotCancelled)")
    if ($stepBlocks.Count -lt 15) { throw "Es wurden nur $($stepBlocks.Count) Schrittbloecke gefunden." }
    foreach ($match in $stepBlocks) {
        $first = $match.Groups[2].Value.Trim()
        # Entweder direkt die Pruefung oder der Schrittaufruf, der sie als erste Anweisung enthaelt.
        if ($first -notmatch "^Confirm-NotCancelled$" -and $first -notmatch "^Enter-Step '([a-z]+)'$") {
            throw "Schritt ohne Abbruchpruefung: $($match.Value.Split("`n")[0].Trim())"
        }
        if ($first -match "^Enter-Step '([a-z]+)'$" -and $Matches[1] -ne $match.Groups[1].Value) {
            throw "Schritt meldet den falschen Namen: $($match.Groups[1].Value) -> $($Matches[1])"
        }
    }
    $enterStep = $body.Substring($body.IndexOf('function Enter-Step', [StringComparison]::Ordinal), 220)
    if ($enterStep -notmatch 'Confirm-NotCancelled') { throw 'Enter-Step prueft die Abbruchbitte nicht.' }
    foreach ($runner in @('function Native(', 'function Invoke-Pip(', 'function Download(')) {
        $position = $body.IndexOf($runner, [StringComparison]::Ordinal)
        if ($position -lt 0) { throw "$runner fehlt." }
        $window = $body.Substring($position, [Math]::Min(900, $body.Length - $position))
        if ($window -notmatch 'Confirm-NotCancelled') { throw "$runner prueft die Abbruchbitte nicht." }
    }
    if ($body -notmatch '\[ABBRUCH\] Fuer diesen Lauf lag bereits eine Abbruchbitte vor') { throw 'Vorstart-Abbruch fehlt.' }

    # --- GUI: erst bitten, dann warten, erst zuletzt beenden
    $guiBody = Get-Content -LiteralPath $gui -Raw -Encoding UTF8
    if ($guiBody -notmatch "lib\\installer-cancel\.ps1") { throw 'GUI bindet das Abbruchmodul nicht ein.' }
    $closing = $guiBody.Substring($guiBody.IndexOf('$form.Add_FormClosing', [StringComparison]::Ordinal))
    if ($closing -notmatch 'Stop-BackendGracefully') { throw 'FormClosing bittet den Lauf nicht um Halt.' }
    if ($closing -match 'taskkill') { throw 'FormClosing beendet den Lauf weiterhin sofort hart.' }
    $stopFunction = $guiBody.Substring($guiBody.IndexOf('function Stop-BackendGracefully', [StringComparison]::Ordinal))
    $stopFunction = $stopFunction.Substring(0, $stopFunction.IndexOf('function Start-Backend', [StringComparison]::Ordinal))
    if ($stopFunction -notmatch 'Request-GuiCancel') { throw 'Stop-BackendGracefully sendet keine Abbruchbitte.' }
    if ($stopFunction -notmatch 'WaitForExit') { throw 'Stop-BackendGracefully wartet nicht auf den Lauf.' }
    if ($stopFunction.IndexOf('taskkill', [StringComparison]::Ordinal) -lt $stopFunction.IndexOf('reagiert nicht', [StringComparison]::Ordinal)) {
        throw 'taskkill kommt vor dem Warten zum Einsatz.'
    }

    # --- Echter Einstiegspunkt: vorliegende Bitte beendet den Lauf ohne Aenderung
    New-Item -ItemType Directory -Force -Path (Join-Path $root 'config') | Out-Null
    $stdout = Join-Path $fixture 'a.out.txt'; $stderr = Join-Path $fixture 'a.err.txt'
    $env:FRIDAY_INSTALL_RUN = 'cancel-e2e-a'
    [void](Request-InstallerCancel -Root $root -RunId 'cancel-e2e-a' -Reason 'Testbitte')
    $arguments = "powershell.exe -NoProfile -ExecutionPolicy Bypass -File `"$installer`" -InstallRoot `"$root`" -UpdateDashboard"
    & cmd.exe /c "$arguments < nul > `"$stdout`" 2> `"$stderr`""
    $codeA = $LASTEXITCODE
    $outA = Get-Content -LiteralPath $stdout -Raw -Encoding UTF8 -ErrorAction SilentlyContinue
    if ($codeA -ne 1) { throw "Abbruch vor dem Start endete mit Code $codeA statt 1. Ausgabe: $outA" }
    if ($outA -notmatch '\[ABBRUCH\]') { throw "Abbruch vor dem Start meldete nichts: $outA" }
    if ($outA -match 'Keine bestehende Installation|unvollstaendig') { throw 'Der Lauf hat trotz Abbruchbitte gearbeitet.' }
    if (Test-Path -LiteralPath (Get-InstallerCancelPath $root)) { throw 'Abbruchbitte blieb nach dem Vorstart-Abbruch liegen.' }
    if (Test-Path -LiteralPath (Join-Path $root 'resume.bat')) { throw 'Vorstart-Abbruch hat einen Fortsetzungsbefehl geschrieben.' }

    # Fremde Laufkennung darf den Lauf nicht beenden: er erreicht die naechste Pruefung.
    $stdout2 = Join-Path $fixture 'b.out.txt'; $stderr2 = Join-Path $fixture 'b.err.txt'
    $env:FRIDAY_INSTALL_RUN = 'cancel-e2e-b'
    [void](Request-InstallerCancel -Root $root -RunId 'anderer-lauf' -Reason 'alt')
    $state = [ordered]@{
        done = @('preflight'); distro_name = 'FRIDAY-Test'; distro_location = (Join-Path $fixture 'distro ablage')
        ports = @{ Dashboard = 45001; Qwen = 45002; HermesApi = 45003; Voice = 45004; CommandCenter = 45010 }
        assistant_name = 'Friday'; wake_phrase = 'Hey Friday'
    }
    New-Item -ItemType Directory -Force -Path $state.distro_location | Out-Null
    [IO.File]::WriteAllText((Join-Path $root 'config\install-state.json'), ($state | ConvertTo-Json -Depth 5), (New-Object System.Text.UTF8Encoding($false)))
    & cmd.exe /c "$arguments < nul > `"$stdout2`" 2> `"$stderr2`""
    $codeB = $LASTEXITCODE
    $outB = Get-Content -LiteralPath $stdout2 -Raw -Encoding UTF8 -ErrorAction SilentlyContinue
    if ($codeB -ne 1) { throw "Lauf mit fremder Abbruchbitte endete mit Code $codeB statt 1. Ausgabe: $outB" }
    if ($outB -match '\[ABBRUCH\]') { throw 'Fremde Abbruchbitte hat den Lauf beendet.' }
    if ($outB -notmatch 'unvollstaendig') { throw "Lauf mit fremder Abbruchbitte erreichte die erwartete Pruefung nicht: $outB" }

    Write-Host 'Kooperativer Abbruch: PASS'
} finally {
    Remove-Item Env:\FRIDAY_INSTALL_RUN -ErrorAction SilentlyContinue
    $resolved = [IO.Path]::GetFullPath($fixture)
    $tempRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\') + '\'
    if (-not $resolved.StartsWith($tempRoot, [StringComparison]::OrdinalIgnoreCase) -or
        -not ([IO.Path]::GetFileName($resolved)).StartsWith('friday cancel-')) { throw "Unsicherer Testpfad: $resolved" }
    if (Test-Path -LiteralPath $resolved) { Remove-Item -LiteralPath $resolved -Recurse -Force }
}