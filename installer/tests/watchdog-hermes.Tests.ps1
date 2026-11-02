# N-142: Der Hermes-Dashboard-Dienst in WSL wurde per SIGTERM beendet und blieb 33 h aus (Restart=on-failure startet nach
# einem sauberen Signal nicht neu, der Watchdog kannte Hermes nicht). Prueft Unit-Richtlinie und Watchdog-Abdeckung.
$ErrorActionPreference = 'Stop'
$script:checks = 0
function Assert-True([bool]$Condition, [string]$Message) { $script:checks++; if (-not $Condition) { throw $Message } }

$hermes = Get-Content -LiteralPath (Join-Path $PSScriptRoot '..\wsl\setup_hermes.sh') -Raw
$watchdog = Get-Content -LiteralPath (Join-Path $PSScriptRoot '..\scripts\friday-watchdog.ps1') -Raw -Encoding UTF8

$unit = [regex]::Match($hermes, '(?s)hermes-dashboard\.service" <<UNIT(.*?)\nUNIT').Groups[1].Value
Assert-True ($unit.Length -gt 0) 'Unit-Block hermes-dashboard.service in setup_hermes.sh nicht gefunden.'
Assert-True ($unit -match 'Restart=always') 'Hermes-Dashboard-Unit startet nach einem SIGTERM nicht neu (Restart=always fehlt).'
Assert-True ($unit -notmatch 'Restart=on-failure') 'Hermes-Dashboard-Unit hat noch Restart=on-failure.'

Assert-True ($watchdog -match "Key = 'hermes-dashboard'[^\r\n]*Unit = 'hermes-dashboard\.service'") 'Watchdog ueberwacht den Hermes-Dashboard-Dienst nicht.'
Assert-True ($watchdog -match "Step = 'hermes'[^\r\n]*Unit = 'hermes-dashboard\.service'") 'Hermes-Dashboard-Ueberwachung haengt nicht am Installationsschritt hermes.'
Assert-True ($watchdog -match 'systemctl --user is-active') 'Watchdog prueft vor dem Neustart nicht, ob der WSL-Dienst nur startet.'
Assert-True ($watchdog -match 'systemctl --user restart \$svc\.Unit') 'Watchdog startet WSL-Dienste nicht ueber systemctl --user restart neu.'

# Die Entscheidungslogik bleibt dieselbe: Port zu, Dienst inaktiv, kein Stop-Flag -> Neustart.
. (Join-Path $PSScriptRoot '..\scripts\friday-watchdog.ps1') -LibraryOnly
$d = Get-WatchdogDecision -PortUp $false -ProcessRunning $false -StopFlag $false -InstallerActive $false -InGrace $false -Now 100000
Assert-True ($d.Action -eq 'restart') "Inaktiver Dienst mit geschlossenem Port wird nicht neu gestartet: $($d.Action)"
$d = Get-WatchdogDecision -PortUp $false -ProcessRunning $true -StopFlag $false -InstallerActive $false -InGrace $false -Now 100000
Assert-True ($d.Action -eq 'loading') "Startender Dienst wird faelschlich neu gestartet: $($d.Action)"

# Ein Stop-Flag, das ein abgebrochenes Update liegen liess, darf den Dienst nicht dauerhaft abschalten (2026-11-01).
$now = [datetime]'2026-11-02T02:00:00'
Assert-True (Test-StopFlagOrphaned -FlagWrittenAt $now.AddMinutes(-270) -Now $now -InstallerActive $false) 'Verwaistes Stop-Flag wird nicht erkannt.'
Assert-True (-not (Test-StopFlagOrphaned -FlagWrittenAt $now.AddSeconds(-20) -Now $now -InstallerActive $false)) 'Frisches Stop-Flag eines laufenden Updates wird entfernt.'
Assert-True (-not (Test-StopFlagOrphaned -FlagWrittenAt $now.AddMinutes(-270) -Now $now -InstallerActive $true)) 'Stop-Flag wird trotz laufendem Installer entfernt.'
Assert-True (-not (Test-StopFlagOrphaned -FlagWrittenAt $null -Now $now -InstallerActive $false)) 'Fehlendes Stop-Flag gilt als verwaist.'
Assert-True ($watchdog -match 'Test-StopFlagOrphaned -FlagWrittenAt \$flagWrittenAt') 'Watchdog-Schleife prueft verwaiste Stop-Flags nicht.'

Write-Host "watchdog-hermes: $script:checks Pruefungen bestanden."
