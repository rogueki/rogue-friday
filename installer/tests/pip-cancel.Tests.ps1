# Abbruch waehrend pip: Invoke-Pip startet cmd, cmd startet python. Ein Abbruch muss den ganzen Baum
# beenden, sonst schreibt der weiterlaufende pip-Lauf das venv halb fertig. Geprueft wird die echte
# Funktion aus dem Installer mit einem Stellvertreter-Interpreter, dessen Kind nach einigen Sekunden
# eine Markierung schreibt.
$ErrorActionPreference = 'Stop'
$installer = Join-Path $PSScriptRoot '..\install-friday.ps1'
. (Join-Path $PSScriptRoot '..\lib\job-object.ps1')
. (Join-Path $PSScriptRoot '..\lib\process-supervisor.ps1')
. (Join-Path $PSScriptRoot '..\lib\installer-cancel.ps1')

$tokens = $null; $errors = $null
$ast = [System.Management.Automation.Language.Parser]::ParseFile($installer, [ref]$tokens, [ref]$errors)
if ($errors.Count) { throw "install-friday.ps1 hat Parserfehler: $($errors[0].Message)" }
$definition = $ast.Find({ param($node) $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq 'Invoke-Pip' }, $true)
if (-not $definition) { throw 'Invoke-Pip fehlt.' }
Invoke-Expression $definition.Extent.Text

$script:Events = @()
function Write-GuiEvent([string]$Type, $Fields) { $script:Events += @{ Type = $Type; Fields = $Fields } }
$script:CancelHits = 0
function Confirm-NotCancelled {
    if (-not (Test-InstallerCancelRequested -Root $Root -RunId $InstallRunId)) { return }
    $script:CancelHits++
    Clear-InstallerCancel -Root $Root -RunId $InstallRunId
    throw 'CANCELLED'
}

function Stop-FakeTree([string]$FakePath) {
    # Ein weiterlaufender Baum haelt Log und Verzeichnis offen; fuer das Aufraeumen muss er weg.
    Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
        Where-Object { $_.CommandLine -and $_.CommandLine -like "*$FakePath*" } |
        ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
}

function Stop-PingTrees {
    Get-CimInstance Win32_Process -Filter "Name='ping.exe'" -ErrorAction SilentlyContinue |
        Where-Object { $_.CommandLine -match 'ping -n 60 127.0.0.1' } |
        ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
}

$fixture = Join-Path ([IO.Path]::GetTempPath()) ("friday-pip-" + [guid]::NewGuid().ToString('N').Substring(0, 8))
try {
    $root = Join-Path $fixture 'root'
    New-Item -ItemType Directory -Force -Path (Join-Path $root 'logs') | Out-Null
    New-Item -ItemType Directory -Force -Path (Join-Path $root 'run') | Out-Null
    $script:Root = $root
    $script:InstallRunId = 'run-pip-test'
    $marker = Join-Path $fixture 'survived.txt'

    # Stellvertreter: startet ein Kind, das nach rund 8 s eine Markierung schreibt, und wartet selbst.
    $fakePython = Join-Path $fixture 'fake-python.cmd'
    $fakeBody = '@echo off' + "`r`n" +
        'start "" /b cmd /c "ping -n 8 127.0.0.1 >nul & echo survived > "' + $marker + '""' + "`r`n" +
        'ping -n 60 127.0.0.1 >nul' + "`r`n"
    [IO.File]::WriteAllText($fakePython, $fakeBody, [Text.Encoding]::Default)

    # 1) Kontrolllauf ohne Abbruch: das Kind schreibt die Markierung wirklich.
    $control = Start-Process -FilePath 'cmd.exe' -PassThru -WindowStyle Hidden -ArgumentList @('/c', "`"$fakePython`"")
    Start-Sleep -Seconds 12
    $controlSurvived = Test-Path -LiteralPath $marker
    try { Stop-Process -Id $control.Id -Force -ErrorAction SilentlyContinue } catch { }
    Stop-PingTrees
    if (-not $controlSurvived) { throw 'Der Kontrolllauf hat keine Markierung geschrieben; der Testaufbau traegt nicht.' }
    Remove-Item -LiteralPath $marker -Force

    # 2) Echter Aufruf mit Abbruch nach drei Sekunden: Invoke-Pip prueft im Takt von fuenf Sekunden.
    $cancelJob = Start-Job -ScriptBlock {
        param($Root, $RunId)
        Start-Sleep -Seconds 3
        $path = Join-Path $Root 'run\installer.cancel'
        $payload = @{ runId = $RunId; reason = 'Nutzer hat abgebrochen'; requestedUtc = (Get-Date).ToUniversalTime().ToString('o') } | ConvertTo-Json -Compress
        [IO.File]::WriteAllText($path, $payload, (New-Object System.Text.UTF8Encoding($false)))
    } -ArgumentList $root, $script:InstallRunId

    $script:aborted = $false
    $elapsed = Measure-Command {
        try { [void](Invoke-Pip -Python $fakePython -PipArgs @('numpy') -Label 'test') }
        catch { if ($_.Exception.Message -eq 'CANCELLED') { $script:aborted = $true } else { throw } }
    }
    try { Stop-Job $cancelJob -ErrorAction SilentlyContinue; Remove-Job $cancelJob -Force -ErrorAction SilentlyContinue } catch { }
    if (-not $script:aborted) { throw "Der Abbruch wurde nicht gemeldet (Laufzeit $([math]::Round($elapsed.TotalSeconds,1)) s)." }
    if ($script:CancelHits -ne 1) { throw "Der Abbruch wurde $($script:CancelHits)x gemeldet statt einmal." }
    if ($elapsed.TotalSeconds -gt 40) { throw "Der Abbruch wirkte erst nach $([math]::Round($elapsed.TotalSeconds,1)) s." }

    # Der Baum muss mit dem Abbruch enden: die Markierung des Kindes darf nicht mehr entstehen.
    Start-Sleep -Seconds 12
    if (Test-Path -LiteralPath $marker) { throw 'Nach dem Abbruch lief der pip-Baum weiter und schrieb sein Ergebnis.' }
    if (Get-CimInstance Win32_Process -Filter "Name='ping.exe'" -ErrorAction SilentlyContinue |
            Where-Object { $_.CommandLine -match 'ping -n 60 127.0.0.1' }) {
        throw 'Nach dem Abbruch lief noch ein ping-Kind des pip-Aufrufs.'
    }
    if (@($script:Events | Where-Object { $_.Type -eq 'pip' }).Count -lt 1) { throw 'Der pip-Start wurde nicht gemeldet.' }

    Write-Host 'Abbruch waehrend pip: PASS'
} finally {
    Stop-PingTrees
    if ($fakePython) { Stop-FakeTree $fakePython }
    Start-Sleep -Seconds 1
    $resolved = [IO.Path]::GetFullPath($fixture)
    $tempRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\') + '\'
    if (-not $resolved.StartsWith($tempRoot, [StringComparison]::OrdinalIgnoreCase) -or
        -not ([IO.Path]::GetFileName($resolved)).StartsWith('friday-pip-')) { throw "Unsicherer Testpfad: $resolved" }
if (Test-Path -LiteralPath $resolved) {
        # Kurz warten: ein gerade beendeter Prozess gibt die Handles nicht sofort frei.
        for ($attempt = 1; $attempt -le 5; $attempt++) {
            try { Remove-Item -LiteralPath $resolved -Recurse -Force -ErrorAction Stop; break }
            catch { Start-Sleep -Seconds 1 }
        }
    }
}