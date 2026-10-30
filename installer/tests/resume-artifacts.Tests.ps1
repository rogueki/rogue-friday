# INS-07: Ein erneuter Lauf erkennt unvollstaendige Artefakte eines abgebrochenen Laufs und baut sie neu auf.
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
. (Join-Path $root 'lib\download-integrity.ps1')

$python = (Get-Command python.exe -ErrorAction SilentlyContinue | Select-Object -First 1).Source
if (-not $python) { throw 'python.exe fehlt: der venv-Test braucht ein echtes Python.' }
$work = Join-Path ([IO.Path]::GetTempPath()) ("friday-resume-" + [guid]::NewGuid().ToString('N').Substring(0, 8))
New-Item -ItemType Directory -Force $work | Out-Null
try {
    if (Test-VenvUsable (Join-Path $work 'fehlt')) { throw 'Ein fehlendes venv gilt als brauchbar.' }

    # Abgebrochener Lauf: python.exe vorhanden, pip fehlt.
    $broken = Join-Path $work 'broken'
    & $python -m venv --without-pip $broken
    if (-not (Test-Path (Join-Path $broken 'Scripts\python.exe'))) { throw 'Testaufbau: venv ohne pip nicht angelegt.' }
    if (Test-VenvUsable $broken) { throw 'Ein venv ohne pip gilt als brauchbar.' }

    $complete = Join-Path $work 'complete'
    & $python -m venv $complete
    if (-not (Test-VenvUsable $complete)) { throw 'Ein vollstaendiges venv gilt als unbrauchbar.' }
    Remove-Item -LiteralPath (Join-Path $complete 'pyvenv.cfg') -Force
    if (Test-VenvUsable $complete) { throw 'Ein venv ohne pyvenv.cfg gilt als brauchbar.' }
} finally {
    Remove-Item -LiteralPath $work -Recurse -Force -ErrorAction SilentlyContinue
}

$script = Get-Content -Raw -Encoding UTF8 (Join-Path $root 'install-friday.ps1')
$venvCheck = $script.IndexOf('-not (Test-VenvUsable $venv)')
$venvCreate = $script.IndexOf('if (-not (Test-Path "$venv\Scripts\python.exe")) { & $py -m venv $venv }')
if ($venvCheck -lt 0 -or $venvCreate -lt 0 -or $venvCheck -gt $venvCreate) { throw 'Die venv-Pruefung steht nicht vor der Neuanlage.' }
if ($script -notmatch 'Remove-Item -LiteralPath \$venv -Recurse -Force') { throw 'Ein unbrauchbares venv wird nicht entfernt.' }

$reset = $script.IndexOf('$State.dashboard_hash = $null; Save-State')
$sync = $script.IndexOf('Sync-DashSource $src')
$commit = $script.IndexOf('$State.dashboard_hash = $hash;')
if ($reset -lt 0 -or $reset -gt $sync -or $sync -gt $commit) {
    throw 'Der Dashboard-Hash wird nicht vor dem Neubau verworfen und erst nach dem Build gesetzt.'
}

Write-Host 'Resume unvollstaendiger Artefakte: PASS'
