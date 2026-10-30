# Installierter Dashboard-Stand: der Installer muss den Commit aus einem Git-Checkout und aus einem GitHub-ZIP
# (export-subst in installer\source-revision.txt) erkennen und einen nicht ersetzten Platzhalter verwerfen.
$ErrorActionPreference = 'Stop'
$installerDir = Join-Path $PSScriptRoot '..'
. (Join-Path $installerDir 'lib\dashboard-sync.ps1')
$repoRoot = (Resolve-Path -LiteralPath (Join-Path $installerDir '..')).Path

$script:checks = 0
function Assert-True([bool]$Condition, [string]$Message) {
    $script:checks++
    if (-not $Condition) { throw $Message }
}

$work = Join-Path $env:TEMP ('friday-revision-' + [guid]::NewGuid().ToString('N'))
try {
    $sha = 'a' * 40
    $zip = Join-Path $work 'zip'
    New-Item -ItemType Directory -Force -Path (Join-Path $zip 'installer') | Out-Null
    [IO.File]::WriteAllText((Join-Path $zip 'installer\source-revision.txt'), "$sha`n")
    Assert-True ((Get-DashboardSourceRevision $zip) -ceq $sha) 'ZIP-Stand mit eingesetztem Commit wird nicht erkannt.'

    [IO.File]::WriteAllText((Join-Path $zip 'installer\source-revision.txt'), "`$Format:%H`$`n")
    Assert-True ($null -eq (Get-DashboardSourceRevision $zip)) 'Nicht ersetzter Platzhalter darf nicht als Commit gelten.'

    [IO.File]::WriteAllText((Join-Path $zip 'installer\source-revision.txt'), "$('A' * 40)`n")
    Assert-True ($null -eq (Get-DashboardSourceRevision $zip)) 'Grossbuchstaben sind kein Git-Commit.'

    $empty = Join-Path $work 'empty'
    New-Item -ItemType Directory -Force -Path $empty | Out-Null
    Assert-True ($null -eq (Get-DashboardSourceRevision $empty)) 'Ohne Git und ohne Datei muss der Stand unbekannt sein.'
    Assert-True ($null -eq (Get-DashboardSourceRevision '')) 'Leere Quelle muss unbekannt sein.'

    $git = Get-Command git.exe -ErrorAction SilentlyContinue
    if ($git -and (Test-Path -LiteralPath (Join-Path $repoRoot '.git'))) {
        $head = (& git.exe -C $repoRoot rev-parse HEAD).Trim()
        Assert-True ((Get-DashboardSourceRevision $repoRoot) -ceq $head) 'Git-Checkout liefert nicht HEAD.'
        $attribute = (& git.exe -C $repoRoot check-attr export-subst -- installer/source-revision.txt) -join ''
        Assert-True ($attribute -match 'export-subst: set$') 'installer/source-revision.txt ist nicht fuer export-subst markiert.'
        $placeholder = ([IO.File]::ReadAllText((Join-Path $repoRoot 'installer\source-revision.txt'))).Trim()
        Assert-True ($placeholder -ceq '$Format:%H$') 'Platzhalter im Repository wurde veraendert.'
    }
    Write-Host "Installierter Dashboard-Stand: PASS ($script:checks Zusicherungen)"
} finally {
    if (Test-Path -LiteralPath $work) { Remove-Item -LiteralPath $work -Recurse -Force }
}
