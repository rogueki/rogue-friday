# Dashboard-Quellen: Inhaltshash und Kopie ins Ziel.
# Der Hash deckt genau das ab, was ausgeliefert wird (Quelldateien ohne Build-Ausgaben und ohne die lokalen
# Konfigurationsdateien des Benutzers). Damit entscheidet der Installer, ob ein neuer Build noetig ist, und ein
# frischer Zielordner bekommt denselben Stand wie das Repository - ohne Sonderbranch.

# The repository's test world (simulation data, mock adapter, Storybook): CI runs its tests on it, an installation never
# loads it, so it is never copied into an installation. apps\mock-console only exists in older installations.
$script:DashboardTestOnlyPaths = @('apps\storybook', 'apps\mock-console', 'adapters\mock', 'packages\mock-data')

function Remove-DashboardTree([string]$Path) {
    # pnpm links packages with junctions: a link is removed as a link and never followed into its target.
    $item = Get-Item -LiteralPath $Path -Force -ErrorAction SilentlyContinue
    if (-not $item) { return }
    if (-not $item.PSIsContainer) { $item.Attributes = [IO.FileAttributes]::Normal; $item.Delete(); return }
    if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { [IO.Directory]::Delete($item.FullName); return }
    foreach ($child in $item.GetFileSystemInfos()) { Remove-DashboardTree $child.FullName }
    [IO.Directory]::Delete($item.FullName)
}

function Remove-DashboardTestOnlyPaths([string]$Target) {
    foreach ($relative in $script:DashboardTestOnlyPaths) { Remove-DashboardTree (Join-Path $Target $relative) }
}

function Get-DashboardSourceFiles([string]$Source, [string[]]$RootFiles, [string[]]$Dirs, [string[]]$ExcludeDirs) {
    $files = New-Object System.Collections.Generic.List[string]
    $base = (Get-Item -LiteralPath $Source).FullName.TrimEnd('\')
    foreach ($name in @($RootFiles)) {
        $path = Join-Path $base $name
        if (Test-Path -LiteralPath $path -PathType Leaf) { $files.Add($path) }
    }
    $stack = New-Object System.Collections.Generic.Stack[string]
    foreach ($name in @($Dirs)) {
        $path = Join-Path $base $name
        if (Test-Path -LiteralPath $path -PathType Container) { $stack.Push($path) }
    }
    while ($stack.Count -gt 0) {
        $current = $stack.Pop()
        $info = New-Object IO.DirectoryInfo $current
        foreach ($sub in $info.GetDirectories()) {
            $relative = $sub.FullName.Substring($base.Length + 1)
            if ($ExcludeDirs -notcontains $sub.Name -and $script:DashboardTestOnlyPaths -notcontains $relative) { $stack.Push($sub.FullName) }
        }
        foreach ($file in $info.GetFiles()) { $files.Add($file.FullName) }
    }
    $files.Sort([StringComparer]::Ordinal)
    return ,$files
}

function Get-DashboardSourceHash([string]$Source, [string[]]$RootFiles, [string[]]$Dirs, [string[]]$ExcludeDirs,
                                 [string[]]$PreserveFiles = @()) {
    # PreserveFiles sind die Dateien, die im Ziel lokal bleiben (dashboard.yaml, adapters.yaml): sie gehoeren
    # nicht in den Hash, sonst erzwaenge eine Benutzereinstellung bei jedem Lauf einen neuen Build.
    $resolvedSource = (Get-Item -LiteralPath $Source).FullName
    $files = Get-DashboardSourceFiles -Source $resolvedSource -RootFiles $RootFiles -Dirs $Dirs -ExcludeDirs $ExcludeDirs
    $builder = New-Object Text.StringBuilder
    foreach ($file in $files) {
        $relative = $file.Substring($resolvedSource.Length).TrimStart('\')
        if ($PreserveFiles -contains $relative) { continue }
        [void]$builder.Append($relative).Append(':').Append((Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash).Append("`n")
    }
    $sha = [Security.Cryptography.SHA256]::Create()
    return (-join ($sha.ComputeHash((New-Object Text.UTF8Encoding $false).GetBytes($builder.ToString())) | ForEach-Object { $_.ToString('x2') }))
}

# Quell-Commit des Dashboards: aus einem Git-Checkout oder aus installer\source-revision.txt, die GitHub beim
# ZIP-Export ausfuellt (export-subst). Ein nicht ersetzter Platzhalter oder fehlendes Git ergibt $null.
function Get-DashboardSourceRevision([string]$Source) {
    if (-not $Source) { return $null }
    if (Test-Path -LiteralPath (Join-Path $Source '.git')) {
        try {
            $revision = & git.exe -C $Source rev-parse HEAD 2>$null
            if ($LASTEXITCODE -eq 0 -and "$revision" -cmatch '^[0-9a-f]{40}$') { return "$revision" }
        } catch { }
    }
    $file = Join-Path $Source 'installer\source-revision.txt'
    if (Test-Path -LiteralPath $file -PathType Leaf) {
        $text = ([IO.File]::ReadAllText($file)).Trim()
        if ($text -cmatch '^[0-9a-f]{40}$') { return $text }
    }
    return $null
}

function Sync-DashboardSource([string]$Source, [string]$Target, [string[]]$RootFiles, [string[]]$Dirs,
                              [string[]]$ExcludeDirs, [string[]]$PreserveFiles = @(), [string[]]$ConfigDirs = @('config')) {
    # /MIR fuer Quellordner (entfernt Veraltetes, laesst ausgeschlossene Ordner im Ziel unberuehrt),
    # /E fuer Konfiguration, damit lokale Werte nicht geloescht werden.
    New-Item -ItemType Directory -Force -Path $Target | Out-Null
    foreach ($name in @($RootFiles)) {
        $file = Join-Path $Source $name
        if (Test-Path -LiteralPath $file -PathType Leaf) { Copy-Item -LiteralPath $file -Destination (Join-Path $Target $name) -Force }
    }
    foreach ($name in @($Dirs)) {
        $dir = Join-Path $Source $name
        if (-not (Test-Path -LiteralPath $dir -PathType Container)) { continue }
        $testOnly = @($script:DashboardTestOnlyPaths | Where-Object { $_.StartsWith($name + '\') } | ForEach-Object { Join-Path $Source $_ })
        # Schluessel im Quellbaum sind Testmaterial; echte Schluessel liegen in data\ und werden nie gespiegelt.
        & robocopy.exe $dir (Join-Path $Target $name) /MIR /XD @ExcludeDirs @testOnly /XF '*.log' '*.key' '*.pem' '*.pfx' '*.p12' /NFL /NDL /NJH /NJS /NP | Out-Null
        if ($LASTEXITCODE -ge 8) { throw "Kopieren von '$name' nach $Target fehlgeschlagen (robocopy-Code $LASTEXITCODE)." }
    }
    # /MIR leaves excluded folders alone; an older installation still has the test world, so it is removed here.
    Remove-DashboardTestOnlyPaths $Target
    foreach ($name in @($ConfigDirs)) {
        $dir = Join-Path $Source $name
        if (-not (Test-Path -LiteralPath $dir -PathType Container)) { continue }
        $arguments = @($dir, (Join-Path $Target $name), '/E') + @($PreserveFiles | ForEach-Object { '/XF'; (Split-Path $_ -Leaf) }) + @('/NFL', '/NDL', '/NJH', '/NJS', '/NP')
        & robocopy.exe @arguments | Out-Null
        if ($LASTEXITCODE -ge 8) { throw "Kopieren von '$name' nach $Target fehlgeschlagen (robocopy-Code $LASTEXITCODE)." }
    }
    foreach ($name in @('config', 'data', 'backups')) { New-Item -ItemType Directory -Force -Path (Join-Path $Target $name) | Out-Null }
    return $Target
}
