# Prepares the isolated acceptance environment for FRIDAY_FINALER_UMSETZUNGSPLAN (BASE-04).
#
# Read-only with respect to the live installation: it copies state out of -SourceRoot, never writes there.
# It produces:
#   <TargetRoot>\snapshot-<Stamp>\      byte copy of non-secret state (config, data, memory, skills registry)
#   <TargetRoot>\restore-drill-<Stamp>\ restored copy used to prove the manifest
#   <TargetRoot>\manifest-<Stamp>.csv   path, bytes, sha256, class, copied
#   <TargetRoot>\fresh-target\          empty install target for REL-03 fresh runs
#
# Secrets are recorded as hash-only rows (copied=0) and are never duplicated into the acceptance tree.
param(
    [string]$SourceRoot = 'D:\Dokumente\F.R.I.D.A.Y',
    [string]$TargetRoot = 'D:\Dokumente\F.R.I.D.A.Y-acceptance',
    [string]$Stamp = (Get-Date -Format 'yyyyMMdd-HHmmss'),
    [switch]$Verify
)
$ErrorActionPreference = 'Stop'

function Assert-UnderTarget([string]$Path) {
    $full = [IO.Path]::GetFullPath($Path)
    $root = [IO.Path]::GetFullPath($TargetRoot).TrimEnd('\') + '\'
    if (-not $full.StartsWith($root, [StringComparison]::OrdinalIgnoreCase)) {
        throw "Refusing to touch '$full' - outside $TargetRoot"
    }
}

$secretPatterns = @('hermes_api.key', 'dashboard_owner.hash', 'auth.key', '.env', '.pem', '.pfx')

# Relative state paths that constitute a restorable installation without models or build output.
$statePaths = @(
    'config',
    'dashboard\data',
    'memory',
    'skills\friday-skills\registry'
)

$snapshot = Join-Path $TargetRoot "snapshot-$Stamp"
$drill = Join-Path $TargetRoot "restore-drill-$Stamp"
$manifestPath = Join-Path $TargetRoot "manifest-$Stamp.csv"
$fresh = Join-Path $TargetRoot 'fresh-target'

foreach ($p in @($snapshot, $drill, $fresh)) {
    Assert-UnderTarget $p
    New-Item -ItemType Directory -Force -Path $p | Out-Null
}

$rows = New-Object System.Collections.Generic.List[object]
$locked = New-Object System.Collections.Generic.List[string]

# Per-file copy with retries: the live database keeps its -shm open, and a state snapshot must not fail
# because of one locked shared-memory file. Locked files are recorded in the manifest instead.
foreach ($rel in $statePaths) {
    $srcRoot = Join-Path $SourceRoot $rel
    if (-not (Test-Path -LiteralPath $srcRoot)) { continue }
    $dstRoot = Join-Path $snapshot $rel
    New-Item -ItemType Directory -Force -Path $dstRoot | Out-Null
    foreach ($file in (Get-ChildItem -LiteralPath $srcRoot -Recurse -File)) {
        $inner = $file.FullName.Substring($srcRoot.Length).TrimStart('\')
        $target = Join-Path $dstRoot $inner
        New-Item -ItemType Directory -Force -Path (Split-Path $target -Parent) | Out-Null
        $copied = $false
        for ($attempt = 0; $attempt -lt 3 -and -not $copied; $attempt++) {
            try { Copy-Item -LiteralPath $file.FullName -Destination $target -Force -ErrorAction Stop; $copied = $true }
            catch { Start-Sleep -Milliseconds 300 }
        }
        if (-not $copied) { $locked.Add("$rel\$inner") }
    }
}

$snapshotFiles = @(Get-ChildItem -LiteralPath $snapshot -Recurse -File)
$snapshotFiles | ForEach-Object {
    $rel = $_.FullName.Substring($snapshot.Length).TrimStart('\')
    $isSecret = $false
    foreach ($pattern in $secretPatterns) { if ($rel.ToLowerInvariant().EndsWith($pattern)) { $isSecret = $true } }
    $class = if ($isSecret) { 'secret' } elseif ($rel -like 'dashboard\data\*') { 'data' } elseif ($rel -like 'memory\*') { 'memory' } elseif ($rel -like 'skills\*') { 'skills' } else { 'config' }
    $rows.Add([pscustomobject]@{
        path   = $rel
        bytes  = $_.Length
        sha256 = (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash
        class  = $class
        copied = if ($isSecret) { 0 } else { 1 }
    })
    if ($isSecret) { Remove-Item -LiteralPath $_.FullName -Force }
}

foreach ($rel in $locked) {
    $rows.Add([pscustomobject]@{ path = $rel; bytes = 0; sha256 = ''; class = 'locked'; copied = 0 })
}

$rows | Export-Csv -LiteralPath $manifestPath -NoTypeInformation -Encoding UTF8

# Restore drill: copy the snapshot again and compare every copied file against the manifest.
& robocopy.exe $snapshot $drill /E /R:1 /W:1 /NFL /NDL /NJH /NJS /NP | Out-Null
if ($LASTEXITCODE -ge 8) { throw "restore robocopy failed (exit $LASTEXITCODE)" }

$mismatch = New-Object System.Collections.Generic.List[string]
$checked = 0
foreach ($row in ($rows | Where-Object { $_.copied -eq 1 })) {
    $restored = Join-Path $drill $row.path
    if (-not (Test-Path -LiteralPath $restored)) { $mismatch.Add("missing: $($row.path)"); continue }
    $hash = (Get-FileHash -LiteralPath $restored -Algorithm SHA256).Hash
    if ($hash -ne $row.sha256) { $mismatch.Add("hash: $($row.path)") }
    $checked++
}

$dbResults = @()
$node = (Get-Command node.exe -ErrorAction SilentlyContinue).Source
if (-not $node) { $node = Join-Path $env:ProgramFiles 'nodejs\node.exe' }
if ($node -and (Test-Path $node)) {
    # The check script goes to a file: quotes passed through `node -e` from PowerShell are stripped.
    $checkScript = Join-Path $TargetRoot "sqlite-integrity-$Stamp.mjs"
    Assert-UnderTarget $checkScript
    $js = @'
import { DatabaseSync } from "node:sqlite";
const db = new DatabaseSync(process.argv[2]);
const result = db.prepare("PRAGMA integrity_check").get();
console.log(JSON.stringify(result));
db.close();
'@
    [IO.File]::WriteAllText($checkScript, $js, (New-Object System.Text.UTF8Encoding($false)))
    foreach ($db in (Get-ChildItem -LiteralPath $drill -Recurse -File -Filter *.sqlite)) {
        # The copy is opened read-write on purpose: a WAL database cannot be opened read-only without a writable -shm.
        $out = & $node --no-warnings $checkScript $db.FullName 2>$null
        $code = $LASTEXITCODE
        $dbResults += [pscustomobject]@{ name = $db.Name; exit = $code; result = ($out -join ' ') }
    }
}

[pscustomobject]@{
    source         = $SourceRoot
    target         = $TargetRoot
    stamp          = $Stamp
    manifest       = $manifestPath
    files          = $rows.Count
    copied         = ($rows | Where-Object { $_.copied -eq 1 }).Count
    secretRows     = ($rows | Where-Object { $_.class -eq 'secret' }).Count
    bytes          = ($rows | Where-Object { $_.copied -eq 1 } | Measure-Object -Property bytes -Sum).Sum
    lockedFiles    = $locked.Count
    restoredChecked = $checked
    mismatches     = $mismatch.Count
    mismatchList   = ($mismatch -join '; ')
    sqlite         = ($dbResults | ForEach-Object { "$($_.name) exit=$($_.exit) $($_.result)" }) -join ' | '
    freshTarget    = $fresh
} | ConvertTo-Json -Depth 4