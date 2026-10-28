# Regressionen aus dem Installationsprotokoll: fuer jeden Fehlerzustand (I-007 Keepalive-Aufgabe, I-009 Ports,
# I-011 pip-Exitcode, I-027 Hermes-Extra, N-006 Dashboard-Hash) eine Probe gegen den aktuellen Installer.
$ErrorActionPreference = 'Stop'
$script:checks = 0
function Assert-True([bool]$Condition, [string]$Message) { $script:checks++; if (-not $Condition) { throw $Message } }

$installer = Join-Path $PSScriptRoot '..\install-friday.ps1'
$body = Get-Content -LiteralPath $installer -Raw -Encoding UTF8
$hermes = Get-Content -LiteralPath (Join-Path $PSScriptRoot '..\wsl\setup_hermes.sh') -Raw

# I-007: Die Keepalive-Aufgabe darf keine vorhandene JARVIS-Aufgabe ueberschreiben.
$registered = [regex]::Matches($body, "Register-UserTask\s+'([^']+)'") | ForEach-Object { $_.Groups[1].Value }
Assert-True (@($registered).Count -ge 1) 'I-007: Kein Register-UserTask-Aufruf im Installer gefunden.'
Assert-True ($registered -contains 'FRIDAY_WSL_Keepalive') 'I-007: FRIDAY_WSL_Keepalive wird nicht registriert.'
$jarvisTasks = @($registered | Where-Object { $_ -like 'jarvis_*' })
Assert-True ($jarvisTasks.Count -eq 0) "I-007: JARVIS-Aufgaben werden ueberschrieben: $($jarvisTasks -join ', ')"
if ($body -match '\$LegacyTaskNames = @\(([^)]*)\)') {
    $legacyNames = [regex]::Matches($Matches[1], "'([^']+)'") | ForEach-Object { $_.Groups[1].Value }
    foreach ($legacyName in $legacyNames) {
        $clash = @($registered | Where-Object { $_ -ieq $legacyName })
        Assert-True ($clash.Count -eq 0) "I-007: Die Legacy-Aufgabe '$legacyName' kollidiert mit einer registrierten Aufgabe."
    }
}

# I-009: Der Installer belegt eigene Ports statt der JARVIS-Ports.
$portsMatch = [regex]::Match($body, '\$State\.ports = @\{ Dashboard = 43791; Qwen = 43792; HermesApi = 43793; Voice = 43794; CommandCenter = 3101 \}')
Assert-True ($portsMatch.Success) 'I-009: Die eigene Portbelegung des Installers fehlt.'
foreach ($jarvisPort in @('43691', '43692', '43693')) {
    Assert-True ($portsMatch.Value -notmatch $jarvisPort) "I-009: Die Portbelegung enthaelt den JARVIS-Port $jarvisPort."
}

# I-027: Der Anthropic-Client von Hermes bekommt sein Extra-Paket, nicht die falsche Paketform.
Assert-True ($hermes -match '(?s)anthropic\|kimi-coding\)\s*\r?\n(?:\s*#[^\n]*\n)*\s*hermes pm install --extra anthropic') 'I-027: hermes pm install --extra anthropic fehlt nach der Anbieterwahl.'
Assert-True ($hermes -notmatch 'pm install anthropic') 'I-027: Die falsche Paketform pm install anthropic steht noch im Skript.'

# N-006: Der Dashboard-Build laeuft nur, wenn sich der Quellhash geaendert hat, und merkt sich den Hash.
Assert-True ($body -match '\$State\.dashboard_hash -eq \$hash -and \$built') 'N-006: Der Quellhash-Vergleich vor dem Dashboard-Build fehlt.'
Assert-True ($body -match '\$State\.dashboard_hash = \$hash; \$State\.dashboard_pnpm = \$pnpmVersion; Save-State') 'N-006: Der Quellhash wird nach dem Build nicht gespeichert.'

# I-011: Invoke-Pip liefert den echten pip-Exitcode und raeumt Log-Marker und cmd-Huelle wieder ab.
$tokens = $null; $errors = $null
$ast = [System.Management.Automation.Language.Parser]::ParseFile($installer, [ref]$tokens, [ref]$errors)
if ($errors.Count) { throw "install-friday.ps1 hat Parserfehler: $($errors[0].Message)" }
$definition = $ast.Find({ param($node) $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq 'Invoke-Pip' }, $true)
if (-not $definition) { throw 'I-011: Invoke-Pip fehlt.' }
Invoke-Expression $definition.Extent.Text

function Confirm-NotCancelled {}
function Write-GuiEvent { param($Name, $Data) }
function New-ProcessJob { [IntPtr]::Zero }
function Add-ProcessToJob { param($Job, $Process) $true }
function Stop-ProcessJob { param($Job) $false }
function Close-ProcessJob { param($Job) }
function Test-InstallerCancelRequested { param($Root, $RunId) $false }

$python = (Get-Command python -ErrorAction SilentlyContinue).Source
if (-not $python) {
    Write-Host 'I-011 uebersprungen: kein python'
} else {
    $fixture = Join-Path ([IO.Path]::GetTempPath()) ("friday-ins10-" + [guid]::NewGuid().ToString('N').Substring(0, 8))
    $oldPythonPath = $env:PYTHONPATH
    try {
        $Root = $fixture
        New-Item -ItemType Directory -Force -Path "$fixture\logs" | Out-Null

        # Stellvertreter-pip als Modul: gibt die Argumente aus und endet mit Exitcode 7.
        $fakePip = Join-Path $fixture 'fakepip'
        New-Item -ItemType Directory -Force -Path (Join-Path $fakePip 'pip') | Out-Null
        [IO.File]::WriteAllText((Join-Path $fakePip 'pip\__init__.py'), '', (New-Object System.Text.UTF8Encoding($false)))
        $mainBody = 'import sys' + "`n" +
            'print("FAKE-PIP " + " ".join(sys.argv[1:]))' + "`n" +
            'sys.exit(7)' + "`n"
        [IO.File]::WriteAllText((Join-Path $fakePip 'pip\__main__.py'), $mainBody, (New-Object System.Text.UTF8Encoding($false)))
        $env:PYTHONPATH = $fakePip

        $code = Invoke-Pip $python @('demo-paket') 'i011'
        Assert-True ($code -eq 7) "I-011: Invoke-Pip lieferte den Exitcode '$code' statt 7."

        $logPath = Join-Path $fixture 'logs\pip-i011.log'
        Assert-True (Test-Path -LiteralPath $logPath) 'I-011: Das pip-Log wurde nicht geschrieben.'
        $log = Get-Content -LiteralPath $logPath -Raw
        Assert-True ($log.Contains('FAKE-PIP install --progress-bar off --no-input demo-paket')) 'I-011: Im pip-Log fehlt die Kommandozeile des Aufrufs.'
        Assert-True (-not (Test-Path -LiteralPath "$logPath.code")) 'I-011: Die Exitcode-Markierung blieb nach dem Lauf liegen.'
        Assert-True (-not (Test-Path -LiteralPath (Join-Path $fixture 'logs\pip-i011.cmd'))) 'I-011: Die cmd-Huelle blieb nach dem Lauf liegen.'
    } finally {
        $env:PYTHONPATH = $oldPythonPath
        Remove-Item -LiteralPath $fixture -Recurse -Force -ErrorAction SilentlyContinue
    }
}

Write-Host "ins10-regressions: $script:checks Pruefungen bestanden."

