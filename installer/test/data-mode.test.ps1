# Verifies the data-mode migration used by the installer (DASH-03: no simulation in a normal installation).
# Run: powershell -NoProfile -ExecutionPolicy Bypass -File installer/test/data-mode.test.ps1
[CmdletBinding()]
param(
    [string]$Root = ''
)
if (-not $Root) { $Root = (Split-Path (Split-Path $PSScriptRoot -Parent) -Parent) }
$ErrorActionPreference = 'Stop'
. (Join-Path $Root 'installer/lib/data-mode.ps1')

$failures = New-Object System.Collections.Generic.List[string]
function Assert-Equal($expected, $actual, $label) {
    if ("$expected" -ne "$actual") { $failures.Add("$label : expected '$expected', got '$actual'") }
}

$tmp = Join-Path ([IO.Path]::GetTempPath()) ("friday-datamode-" + [guid]::NewGuid().ToString('N'))
$backups = Join-Path $tmp 'backups'
New-Item -ItemType Directory -Force -Path $tmp | Out-Null

function Write-Config([string]$name, [string]$content) {
    $path = Join-Path $tmp $name
    [IO.File]::WriteAllText($path, $content, (New-Object System.Text.UTF8Encoding($false)))
    return $path
}

# 1. hybrid -> live, comment preserved, backup written
$hybrid = Write-Config 'hybrid.yaml' "dataMode: hybrid # mock | hybrid | live`r`nserver:`r`n  port: 3101`r`n"
$result = Set-ProductionDataMode -DashboardYaml $hybrid -BackupDir $backups
Assert-Equal 'True' $result.Changed 'hybrid: changed'
Assert-Equal 'hybrid' $result.From 'hybrid: from'
Assert-Equal 'live' (Get-ConfiguredDataMode $hybrid) 'hybrid: value'
Assert-Equal 'True' ([IO.File]::ReadAllText($hybrid).Contains('# mock | hybrid | live')) 'hybrid: comment kept'
Assert-Equal 'True' (Test-Path -LiteralPath $result.Backup) 'hybrid: backup written'
Assert-Equal 'True' ((Get-Content -LiteralPath $result.Backup -Raw) -match 'dataMode: hybrid') 'hybrid: backup content'

# 2. mock -> live
$mock = Write-Config 'mock.yaml' "dataMode: mock`r`n"
$result = Set-ProductionDataMode -DashboardYaml $mock -BackupDir $backups
Assert-Equal 'True' $result.Changed 'mock: changed'
Assert-Equal 'live' (Get-ConfiguredDataMode $mock) 'mock: value'

# 3. live stays untouched, no backup
$live = Write-Config 'live.yaml' "dataMode: live`r`n"
$before = @(Get-ChildItem $backups -File -ErrorAction SilentlyContinue).Count
$result = Set-ProductionDataMode -DashboardYaml $live -BackupDir $backups
Assert-Equal 'False' $result.Changed 'live: unchanged'
Assert-Equal 'already-live' $result.Reason 'live: reason'
Assert-Equal $before (@(Get-ChildItem $backups -File -ErrorAction SilentlyContinue).Count) 'live: no backup'

# 4. missing file is not an error and changes nothing
$missing = Join-Path $tmp 'nope.yaml'
$result = Set-ProductionDataMode -DashboardYaml $missing -BackupDir $backups
Assert-Equal 'False' $result.Changed 'missing: unchanged'
Assert-Equal 'missing' $result.Reason 'missing: reason'
Assert-Equal 'False' (Test-Path -LiteralPath $missing) 'missing: not created'

# 5. DryRun reports the change without touching the file
$dry = Write-Config 'dry.yaml' "dataMode: hybrid`r`n"
$result = Set-ProductionDataMode -DashboardYaml $dry -BackupDir $backups -DryRun
Assert-Equal 'True' $result.Changed 'dryrun: changed'
Assert-Equal 'hybrid' (Get-ConfiguredDataMode $dry) 'dryrun: file untouched'
Assert-Equal '' "$($result.Backup)" 'dryrun: no backup path'

# 6. the shipped template is live
$installer = Get-Content -LiteralPath (Join-Path $Root 'installer/install-friday.ps1') -Raw
if ($installer -match '(?m)^dataMode:\s*(mock|hybrid)\b') { $failures.Add('installer template still ships mock/hybrid') }
if ($installer -notmatch '(?m)^dataMode:\s*live\b') { $failures.Add('installer template does not ship dataMode: live') }
if ($installer -notmatch 'Set-ProductionDataMode') { $failures.Add('installer does not call Set-ProductionDataMode') }

Remove-Item -LiteralPath $tmp -Recurse -Force -ErrorAction SilentlyContinue

if ($failures.Count -gt 0) {
    $failures | ForEach-Object { Write-Host "FAIL $_" }
    Write-Host "data-mode tests: $($failures.Count) failure(s)"
    exit 1
}
Write-Host 'data-mode tests: all checks passed'
exit 0