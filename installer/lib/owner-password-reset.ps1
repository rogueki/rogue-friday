# Local owner password reset: back up the hash file, then replace it; neither password nor hash is ever printed.

function Set-OwnerHashFileAcl([string]$Path) {
    & icacls.exe $Path /inheritance:r /grant:r "$($env:USERNAME):(R,W)" /grant:r 'SYSTEM:(R)' | Out-Null
    if ($LASTEXITCODE -ne 0) {
        throw "Die Rechte der Hash-Datei liessen sich nicht setzen: $Path"
    }
}

function Set-OwnerPasswordHash([string]$InstallRoot, [string]$Hash) {
    if ($Hash -notmatch '^scrypt\$\d+\$\d+\$\d+\$[A-Za-z0-9+/]+={0,2}\$[A-Za-z0-9+/]+={0,2}$') {
        throw 'Der erzeugte Hash hat ein unerwartetes Format.'
    }

    $file = Join-Path $InstallRoot 'config\dashboard_owner.hash'
    if (-not (Test-Path -LiteralPath $file -PathType Leaf) -or (Get-Item -LiteralPath $file).Length -eq 0) {
        throw 'Es ist noch kein Besitzerkonto eingerichtet. Die Ersteinrichtung erfolgt im Dashboard.'
    }

    $backupDir = Join-Path $InstallRoot ('backups\owner-password-' + (Get-Date -Format 'yyyyMMdd-HHmmss'))
    New-Item -ItemType Directory -Force -Path $backupDir | Out-Null
    $backupFile = Join-Path $backupDir 'dashboard_owner.hash'
    Copy-Item -LiteralPath $file -Destination $backupFile -Force
    Set-OwnerHashFileAcl $backupFile

    [IO.File]::WriteAllText($file, $Hash, (New-Object Text.UTF8Encoding $false))
    Set-OwnerHashFileAcl $file

    return $backupDir
}
