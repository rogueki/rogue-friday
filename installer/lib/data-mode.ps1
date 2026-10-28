# Data-mode migration for the FRIDAY dashboard configuration.
#
# The product must not fabricate data in a normal installation: `dataMode: mock` and `dataMode: hybrid`
# create mock adapters (or placeholder world state) for every category that has no real provider. Earlier
# installer versions shipped `hybrid`, so an upgrade has to move an existing configuration to `live`
# explicitly, with a backup, instead of silently keeping the simulation.
#
# Dot-sourced by install-friday.ps1; also loaded directly by installer/test/data-mode.test.ps1.

function Set-ProductionDataMode {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][string]$DashboardYaml,
        [Parameter(Mandatory = $true)][string]$BackupDir,
        [switch]$DryRun
    )

    if (-not (Test-Path -LiteralPath $DashboardYaml)) {
        return [pscustomobject]@{ Changed = $false; From = $null; Backup = $null; Reason = 'missing' }
    }

    $text = [System.IO.File]::ReadAllText($DashboardYaml)
    $match = [regex]::Match($text, '(?m)^([ \t]*dataMode:[ \t]*)([A-Za-z]+)')
    if (-not $match.Success) {
        return [pscustomobject]@{ Changed = $false; From = $null; Backup = $null; Reason = 'no-dataMode' }
    }

    $current = $match.Groups[2].Value
    if ($current -eq 'live') {
        return [pscustomobject]@{ Changed = $false; From = 'live'; Backup = $null; Reason = 'already-live' }
    }
    if ($current -ne 'mock' -and $current -ne 'hybrid') {
        return [pscustomobject]@{ Changed = $false; From = $current; Backup = $null; Reason = 'unknown-mode' }
    }

    $backup = $null
    if (-not $DryRun) {
        if (-not (Test-Path -LiteralPath $BackupDir)) { New-Item -ItemType Directory -Force -Path $BackupDir | Out-Null }
        $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
        $backup = Join-Path $BackupDir ("dashboard.yaml.bak-dataMode-$stamp")
        Copy-Item -LiteralPath $DashboardYaml -Destination $backup -Force
        $updated = [regex]::Replace($text, '(?m)^([ \t]*dataMode:[ \t]*)(mock|hybrid)\b', '${1}live')
        # Keep the byte layout (CRLF/BOM) of the file the installer wrote itself.
        $encoding = New-Object System.Text.UTF8Encoding($false)
        [System.IO.File]::WriteAllText($DashboardYaml, $updated, $encoding)
    }

    return [pscustomobject]@{ Changed = $true; From = $current; Backup = $backup; Reason = 'migrated' }
}

function Get-ConfiguredDataMode {
    [CmdletBinding()]
    param([Parameter(Mandatory = $true)][string]$DashboardYaml)

    if (-not (Test-Path -LiteralPath $DashboardYaml)) { return $null }
    $text = [System.IO.File]::ReadAllText($DashboardYaml)
    $match = [regex]::Match($text, '(?m)^[ \t]*dataMode:[ \t]*([A-Za-z]+)')
    if ($match.Success) { return $match.Groups[1].Value }
    return $null
}