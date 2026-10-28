# Rollback drill for BASE-04 / DASH-03.05: restore the snapshot into a scratch root, boot the built control API
# against it and prove that it becomes ready. The live installation is never touched: every path in the restored
# configuration is rewritten to the drill root and the port is changed.
#
# Run: powershell -NoProfile -ExecutionPolicy Bypass -File scripts/finalization/rollback-drill.ps1 -Stamp <stamp>
param(
    [string]$TargetRoot = 'D:\Dokumente\F.R.I.D.A.Y-acceptance',
    [Parameter(Mandatory = $true)][string]$Stamp,
    [int]$Port = 3117,
    [switch]$Migrate
)
$ErrorActionPreference = 'Stop'

$repo = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
$snapshot = Join-Path $TargetRoot "snapshot-$Stamp"
$drill = Join-Path $TargetRoot "rollback-drill-$Stamp"
$main = Join-Path $repo 'apps\control-api\dist\main.js'
if (-not (Test-Path -LiteralPath $snapshot)) { throw "Snapshot fehlt: $snapshot" }
if (-not (Test-Path -LiteralPath $main)) { throw "Build fehlt: $main (pnpm build:app)" }

if (Test-Path -LiteralPath $drill) { Remove-Item -LiteralPath $drill -Recurse -Force }
& robocopy.exe $snapshot $drill /E /R:1 /W:1 /NFL /NDL /NJH /NJS /NP | Out-Null
if ($LASTEXITCODE -ge 8) { throw "Restore fehlgeschlagen (robocopy $LASTEXITCODE)" }

$drillDash = Join-Path $drill 'dashboard'
$yamlPath = Join-Path $drillDash 'config\dashboard.yaml'
$yaml = [IO.File]::ReadAllText($yamlPath)
$rootYaml = $drill.Replace('\', '/')
$yaml = [regex]::Replace($yaml, '(?m)^(\s*port:\s*)\d+', ('${1}' + $Port))
$yaml = [regex]::Replace($yaml, '(?m)^(\s*dataDir:\s*)"[^"]*"', ('${1}"' + $rootYaml + '/dashboard/data"'))
$yaml = [regex]::Replace($yaml, '(?m)^(\s*logDir:\s*)"[^"]*"', ('${1}"' + $rootYaml + '/logs/dashboard"'))
$yaml = [regex]::Replace($yaml, '(?m)^(\s*backupDir:\s*)"[^"]*"', ('${1}"' + $rootYaml + '/dashboard/backups"'))
$yaml = [regex]::Replace($yaml, '(?m)^(\s*webRoot:\s*)"[^"]*"', ('${1}"' + $rootYaml + '/dashboard/apps/web/out"'))
$yaml = [regex]::Replace($yaml, '(?m)^(\s*ownerPasswordHash:\s*).*$', '${1}"env:FRIDAY_OWNER_PASSWORD_HASH"')
[IO.File]::WriteAllText($yamlPath, $yaml, (New-Object System.Text.UTF8Encoding($false)))

# Optional: run the shipped data-mode migration on the restored configuration, so the drill also proves that an
# existing hybrid installation becomes a live one without losing its database.
if ($Migrate) {
    . (Join-Path $repo 'installer/lib/data-mode.ps1')
    $mode = Set-ProductionDataMode -DashboardYaml $yamlPath -BackupDir (Join-Path $drill 'backups')
}

# Adapters off: the drill proves that restored configuration and database boot; it must not poll the live
# services or scan disks. The adapter wiring itself is covered by the runtime tests.
[IO.File]::WriteAllText((Join-Path $drillDash 'config\adapters.yaml'), "allowlist: {}`r`nadapters: {}`r`n", (New-Object System.Text.UTF8Encoding($false)))
New-Item -ItemType Directory -Force -Path (Join-Path $drill 'logs\dashboard') | Out-Null

$env:FRIDAY_OWNER_PASSWORD_HASH = 'scrypt$16384$8$1$AAAA$BBBB'
$log = Join-Path $drill 'drill.log'
$proc = Start-Process -FilePath (Get-Command node.exe).Source -ArgumentList @($main) -WorkingDirectory $drillDash `
    -RedirectStandardOutput $log -RedirectStandardError "$log.err" -PassThru -WindowStyle Hidden

$health = $null
$deadline = (Get-Date).AddSeconds(45)
try {
    while ((Get-Date) -lt $deadline) {
        if ($proc.HasExited) { break }
        try {
            $response = Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:$Port/api/v1/health" -TimeoutSec 3
            if ($response.StatusCode -eq 200) { $health = $response.Content | ConvertFrom-Json; break }
        } catch { Start-Sleep -Milliseconds 500 }
    }
} finally {
    if (-not $proc.HasExited) { $proc.Kill(); $proc.WaitForExit(10000) | Out-Null }
}

[pscustomobject]@{
    drill        = $drill
    exited       = $proc.HasExited
    exitCode     = $(if ($proc.HasExited) { $proc.ExitCode } else { $null })
    healthStatus = $(if ($health) { $health.status } else { $null })
    contract     = $(if ($health) { $health.contractVersion } else { $null })
    dataMode     = $(if ($Migrate) { 'live (migriert)' } else { 'unverändert' })
    adapterOnline = $(if ($health) { ($health.components | Where-Object { $_.status -eq 'online' }).Count } else { 0 })
    components   = $(if ($health) { $health.components.Count } else { 0 })
    logTail      = (@(Get-Content -LiteralPath $log -Tail 5 -ErrorAction SilentlyContinue) -join ' | ')
    errTail      = (@(Get-Content -LiteralPath "$log.err" -Tail 5 -ErrorAction SilentlyContinue) -join ' | ')
} | ConvertTo-Json -Depth 3

if (-not $health) { exit 1 }
exit 0