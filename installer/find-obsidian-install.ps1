function Find-ObsidianInstall {
    param(
        [string[]]$CandidatePaths = @(),
        [switch]$OnlyCandidates
    )

    $paths = New-Object 'System.Collections.Generic.List[string]'
    foreach ($path in $CandidatePaths) { if ($path) { $paths.Add($path) } }
    if (-not $OnlyCandidates) {
        foreach ($path in @(
            $env:FRIDAY_OBSIDIAN_APP,
            $(if ($env:LOCALAPPDATA) { Join-Path $env:LOCALAPPDATA 'Obsidian\Obsidian.exe' }),
            $(if ($env:ProgramFiles) { Join-Path $env:ProgramFiles 'Obsidian\Obsidian.exe' }),
            $(if (${env:ProgramFiles(x86)}) { Join-Path ${env:ProgramFiles(x86)} 'Obsidian\Obsidian.exe' }),
            'D:\obsidian\App\Obsidian.exe'
        )) { if ($path) { $paths.Add($path) } }

        foreach ($command in @(Get-Command Obsidian.exe -All -ErrorAction SilentlyContinue)) {
            if ($command.Source) { $paths.Add($command.Source) }
        }
        foreach ($root in @('Registry::HKEY_CURRENT_USER', 'Registry::HKEY_LOCAL_MACHINE')) {
            $appPath = "$root\Software\Microsoft\Windows\CurrentVersion\App Paths\Obsidian.exe"
            try {
                $appKey = Get-Item -LiteralPath $appPath -ErrorAction Stop
                $registered = [string]$appKey.GetValue('')
                if ($registered) { $paths.Add($registered) }
            } catch { }
            foreach ($uninstallRoot in @(
                "$root\Software\Microsoft\Windows\CurrentVersion\Uninstall",
                "$root\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall"
            )) {
                foreach ($entry in @(Get-ChildItem -LiteralPath $uninstallRoot -ErrorAction SilentlyContinue)) {
                    try { $app = Get-ItemProperty -LiteralPath $entry.PSPath -ErrorAction Stop } catch { continue }
                    if ($app.DisplayName -notmatch '^Obsidian(?:\s|$)') { continue }
                    if ($app.InstallLocation) { $paths.Add((Join-Path $app.InstallLocation 'Obsidian.exe')) }
                    if ($app.DisplayIcon) {
                        $icon = [string]$app.DisplayIcon
                        if ($icon -match '^"([^"]+\.exe)"(?:,\d+)?$') { $paths.Add($Matches[1]) }
                        elseif ($icon -match '^(.+\.exe)(?:,\d+)?$') { $paths.Add($Matches[1]) }
                    }
                }
            }
        }
    }

    $seen = New-Object 'System.Collections.Generic.HashSet[string]' ([StringComparer]::OrdinalIgnoreCase)
    foreach ($candidate in $paths) {
        try {
            $full = [IO.Path]::GetFullPath($candidate)
            if ([IO.Path]::GetFileName($full) -ine 'Obsidian.exe' -or -not $seen.Add($full)) { continue }
            $item = Get-Item -LiteralPath $full -ErrorAction Stop
            if ($item.PSIsContainer -or $item.Length -lt 2) { continue }
            $stream = [IO.File]::OpenRead($item.FullName)
            try {
                if ($stream.ReadByte() -eq 77 -and $stream.ReadByte() -eq 90) { return $item.FullName }
            } finally { $stream.Dispose() }
        } catch { }
    }
    return $null
}

function Invoke-ObsidianPackageInstall {
    if (-not (Get-Command winget.exe -ErrorAction SilentlyContinue)) { throw 'Obsidian fehlt und winget ist nicht verfügbar.' }
    & winget.exe install --exact --id Obsidian.Obsidian --scope machine --accept-package-agreements --accept-source-agreements --silent | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "Obsidian-Installation fehlgeschlagen (winget exit $LASTEXITCODE)." }
}

function Ensure-ObsidianInstall {
    param([string[]]$CandidatePaths = @(), [switch]$OnlyCandidates)
    $app = Find-ObsidianInstall -CandidatePaths $CandidatePaths -OnlyCandidates:$OnlyCandidates
    if ($app) { return [pscustomobject]@{ path = $app; installed = $false } }
    Invoke-ObsidianPackageInstall
    $app = Find-ObsidianInstall -CandidatePaths $CandidatePaths -OnlyCandidates:$OnlyCandidates
    if (-not $app) { throw 'winget meldete Erfolg, aber kein nutzbarer Obsidian.exe-Pfad wurde gefunden.' }
    return [pscustomobject]@{ path = $app; installed = $true }
}
