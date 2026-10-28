$ErrorActionPreference = 'Stop'
$installer = Join-Path $PSScriptRoot '..\install-friday.ps1'
$tokens = $null
$errors = $null
$ast = [System.Management.Automation.Language.Parser]::ParseFile($installer, [ref]$tokens, [ref]$errors)
if ($errors.Count) { throw "Installer hat PowerShell-Parserfehler: $($errors[0].Message)" }
$definition = $ast.Find({ param($node) $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq 'Move-LegacyDashboardTask' }, $true)
if (-not $definition) { throw 'Move-LegacyDashboardTask fehlt.' }
Invoke-Expression $definition.Extent.Text

$script:Root = 'D:\Kali\Friday'
$script:Inst = "$Root\installer"
$script:ProcessRoots = @("$Root\")
$script:DashPort = 3101
function Test-TaskForInstallRoot($task) { return $true }
function Get-ScheduledTask {
    param($TaskName, $ErrorAction)
    if ($TaskName -eq 'JARVIS_Dashboard' -and $script:oldExists) {
        return [pscustomobject]@{ TaskPath = '\'; Actions = @([pscustomobject]@{ Execute = 'wscript.exe'; Arguments = "`"$($script:oldActionRoot)\installer\scripts\hidden.vbs`" `"$($script:oldActionRoot)\installer\scripts\start-dashboard.ps1`"" }) }
    }
    if ($TaskName -eq 'FRIDAY_Dashboard' -and $script:newExists) {
        return [pscustomobject]@{ TaskPath = '\'; Actions = @([pscustomobject]@{ Execute = 'wscript.exe'; Arguments = "`"$Root\installer\scripts\start-dashboard.ps1`"" }) }
    }
    return $null
}
function Register-UserTask {
    if ($script:failRegister) { throw 'Registrierung fehlgeschlagen' }
    $script:newExists = $true
    $script:events += 'register-new'
}
function Stop-DashboardService {
    $script:oldStopped = $true
    $script:events += 'stop-old'
}
function Get-PortOwner($port) { return $null }
function Start-ScheduledTask {
    param($TaskName, $ErrorAction)
    $script:events += "start-$TaskName"
}
function Stop-LauncherService {
    $script:events += 'stop-new'
}
function Test-DashboardHealth($seconds) {
    if ($script:healthy) { return [pscustomobject]@{ Up = $true; Code = 200 } }
    return [pscustomobject]@{ Up = $false; Code = 0 }
}
function Start-Sleep($seconds) {}
function Unregister-ScheduledTask {
    param($TaskName, $Confirm, $ErrorAction)
    $script:events += "remove-$TaskName"
    if ($TaskName -eq 'JARVIS_Dashboard' -and $script:failRemoveOld) { throw 'Entfernen fehlgeschlagen' }
    if ($TaskName -eq 'JARVIS_Dashboard') { $script:oldExists = $false }
    if ($TaskName -eq 'FRIDAY_Dashboard') { $script:newExists = $false }
}
function Stop-Dashboard($message) { throw $message }
function Ok($message) {}
function Warn($message) {}
function Assert($condition, $message) { if (-not $condition) { throw $message } }
function Reset-Fixture {
    $script:DashTask = 'JARVIS_Dashboard'
    $script:oldExists = $true
    $script:newExists = $false
    $script:oldStopped = $false
    $script:failRegister = $false
    $script:failRemoveOld = $false
    $script:oldActionRoot = $Root
    $script:healthy = $true
    $script:events = @()
}

Reset-Fixture
Move-LegacyDashboardTask | Out-Null
Assert ($DashTask -eq 'FRIDAY_Dashboard' -and $newExists -and -not $oldExists) 'Erfolgsweg: alter Task nicht ersetzt.'
Assert (($events -join ',') -eq 'register-new,stop-old,start-FRIDAY_Dashboard,remove-JARVIS_Dashboard') 'Erfolgsweg: falsche Reihenfolge.'

Reset-Fixture
$script:healthy = $false
try { Move-LegacyDashboardTask | Out-Null; throw 'Health-Fehler wurde nicht gemeldet.' } catch {
    Assert ($_.Exception.Message -like '*Migration fehlgeschlagen*') 'Health-Fehler: unerwartete Ausnahme.'
}
Assert ($oldExists -and -not $newExists -and $DashTask -eq 'JARVIS_Dashboard') 'Health-Fehler: Legacy-Autostart ging verloren.'
Assert (($events -join ',') -like '*stop-new,remove-FRIDAY_Dashboard,start-JARVIS_Dashboard') 'Health-Fehler: Rueckfall fehlt.'

Reset-Fixture
$script:failRegister = $true
try { Move-LegacyDashboardTask | Out-Null; throw 'Registrierungsfehler wurde nicht gemeldet.' } catch {
    Assert ($_.Exception.Message -like '*Migration fehlgeschlagen*') 'Registrierungsfehler: unerwartete Ausnahme.'
}
Assert ($oldExists -and -not $newExists -and -not $oldStopped) 'Registrierungsfehler: Legacy-Aufgabe wurde angefasst.'

Reset-Fixture
$script:oldActionRoot = 'C:\OtherFriday'
try { Move-LegacyDashboardTask | Out-Null; throw 'Fremde Legacy-Aufgabe wurde akzeptiert.' } catch {
    Assert ($_.Exception.Message -like '*keinen bekannten Dashboard-Launcher*') 'Fremdaufgabe: unerwartete Ausnahme.'
}
Assert ($oldExists -and -not $newExists -and $events.Count -eq 0) 'Fremdaufgabe wurde veraendert.'

Reset-Fixture
$script:failRemoveOld = $true
try { Move-LegacyDashboardTask | Out-Null; throw 'Entfernungsfehler wurde nicht gemeldet.' } catch {
    Assert ($_.Exception.Message -like '*Migration fehlgeschlagen*') 'Entfernungsfehler: unerwartete Ausnahme.'
}
Assert ($oldExists -and -not $newExists) 'Entfernungsfehler: Legacy-Autostart ging verloren.'
Assert (($events -join ',') -like '*stop-new,remove-FRIDAY_Dashboard,start-JARVIS_Dashboard') 'Entfernungsfehler: Rueckfall fehlt.'
Write-Output 'PASS: Dashboard-Aufgabenmigration (Erfolg, Health, Registrierung, fremder Root, Entfernen)'
