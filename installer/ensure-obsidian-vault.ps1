function Ensure-FridayObsidianVault {
    param([Parameter(Mandatory)][string]$Path)
    $vault = [IO.Path]::GetFullPath($Path)
    if ($vault -notmatch '^[A-Za-z]:\\[^<>:"|?*]+$') { throw 'Vault muss ein lokaler absoluter Pfad sein.' }
    foreach ($folder in @('.obsidian','Conversations','Daily','People','Projects','Knowledge','Decisions','Attachments')) {
        $directory = Join-Path $vault $folder
        if (-not (Test-Path -LiteralPath $directory -PathType Container)) {
            New-Item -ItemType Directory -Path $directory -Force | Out-Null
        }
    }
    $probe = Join-Path $vault ('.friday-write-test-' + [guid]::NewGuid().ToString('N'))
    try {
        [IO.File]::WriteAllText($probe, 'test')
        if ([IO.File]::ReadAllText($probe) -ne 'test') { throw 'Vault-Leseprobe fehlgeschlagen.' }
    } finally { Remove-Item -LiteralPath $probe -Force -ErrorAction SilentlyContinue }
    return $vault
}
