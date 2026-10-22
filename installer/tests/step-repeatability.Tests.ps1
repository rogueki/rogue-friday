# Wiederholbarkeit halb erledigter Schritte: ein Lauf, der mitten in einem Schritt abbrach, hinterlaesst
# Artefakte, aber keinen Fortschrittseintrag. Ein erneuter Lauf muss diese Artefakte akzeptieren, den
# gespeicherten Fortschritt nicht zuruecksetzen und den Schritt wiederholen koennen.
$ErrorActionPreference = 'Stop'
$installer = Join-Path $PSScriptRoot '..\install-friday.ps1'

# --- Fortschritt ist idempotent
$tokens = $null; $errors = $null
$ast = [System.Management.Automation.Language.Parser]::ParseFile($installer, [ref]$tokens, [ref]$errors)
if ($errors.Count) { throw "install-friday.ps1 hat Parserfehler: $($errors[0].Message)" }
$fixture = Join-Path ([IO.Path]::GetTempPath()) ("friday-repeat-" + [guid]::NewGuid().ToString('N').Substring(0, 8))
try {
    # MarkDone meldet den Abschluss an die GUI; hier wird nur der Zustand geprueft.
    function Write-GuiEvent { param($Type, $Fields) }
    foreach ($name in @('MarkDone', 'IsDone', 'Save-State', 'Read-InstallerState', 'Import-InstallerState')) {
        $definition = $ast.Find({ param($node) $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq $name }, $true)
        if (-not $definition) { throw "$name fehlt." }
        Invoke-Expression $definition.Extent.Text
    }
    New-Item -ItemType Directory -Force -Path (Join-Path $fixture 'config') | Out-Null
    $script:StateFile = Join-Path $fixture 'config\install-state.json'
    $script:State = [ordered]@{ done = @() }
    MarkDone 'files'
    MarkDone 'files'
    MarkDone 'wslfeature'
    if (@($script:State.done).Count -ne 2) { throw "Doppelter Abschluss wurde nicht zusammengefasst: $(@($script:State.done) -join ',')." }
    $reloaded = Import-InstallerState $script:StateFile
    if (@($reloaded.State.done).Count -ne 2) { throw 'Gespeicherter Fortschritt enthaelt Duplikate oder verlor Schritte.' }
    if (-not (IsDone 'files')) { throw 'Abgeschlossener Schritt gilt nicht als erledigt.' }
    if (IsDone 'voicepython') { throw 'Nicht abgeschlossener Schritt gilt als erledigt.' }

    # --- Halb erledigter Schritt am echten Einstiegspunkt
    $root = Join-Path $fixture 'Ziel ordner ü'
    $stateFile = Join-Path $root 'config\install-state.json'
    foreach ($directory in @('config', 'models\tts', 'voice\partial', 'logs')) {
        New-Item -ItemType Directory -Force -Path (Join-Path $root $directory) | Out-Null
    }
    # Artefakte, wie sie ein Abbruch mitten im Schritt hinterlaesst: fertige Dateien, halbe Kopien.
    [IO.File]::WriteAllText((Join-Path $root 'config\voice.json'), '{"tts_backend":"piper"}', (New-Object System.Text.UTF8Encoding($false)))
    [IO.File]::WriteAllText((Join-Path $root 'models\tts\de_DE-kerstin-low.onnx'), 'halb', (New-Object System.Text.UTF8Encoding($false)))
    [IO.File]::WriteAllText((Join-Path $root 'voice\partial\voice_persona.py'), '# halb kopiert', (New-Object System.Text.UTF8Encoding($false)))
    $state = [ordered]@{
        done            = @('preflight', 'files')
        distro_name     = 'FRIDAY-Test'
        distro_location = (Join-Path $fixture 'distro ablage')
        ports           = @{ Dashboard = 45101; Qwen = 45102; HermesApi = 45103; Voice = 45104; CommandCenter = 45110 }
        assistant_name  = 'Friday'
        wake_phrase     = 'Hey Friday'
    }
    New-Item -ItemType Directory -Force -Path $state.distro_location | Out-Null
    [IO.File]::WriteAllText($stateFile, ($state | ConvertTo-Json -Depth 5), (New-Object System.Text.UTF8Encoding($false)))

    $stdout = Join-Path $fixture 'repeat.out.txt'
    $stderr = Join-Path $fixture 'repeat.err.txt'
    & cmd.exe /c "powershell.exe -NoProfile -ExecutionPolicy Bypass -File `"$installer`" -InstallRoot `"$root`" -UpdateDashboard < nul > `"$stdout`" 2> `"$stderr`""
    $code = $LASTEXITCODE
    $out = Get-Content -LiteralPath $stdout -Raw -Encoding UTF8 -ErrorAction SilentlyContinue
    if ($code -ne 1) { throw "Wiederholung endete mit Code $code statt 1: $out $($(Get-Content -LiteralPath $stderr -Raw -Encoding UTF8 -ErrorAction SilentlyContinue))" }
    if ($out -match 'nicht leer') { throw "Halb erledigte Artefakte galten als fremder Inhalt: $out" }
    if ($out -notmatch 'unvollstaendig') { throw "Wiederholung erreichte die erwartete Pruefung nicht: $out" }

    # Der gespeicherte Fortschritt bleibt erhalten, die Artefakte bleiben unangetastet.
    $after = Get-Content -LiteralPath $stateFile -Raw -Encoding UTF8 | ConvertFrom-Json
    if (@($after.done).Count -ne 2) { throw "Fortschritt wurde zurueckgesetzt: $(@($after.done) -join ',')." }
    if ($after.distro_name -ne 'FRIDAY-Test') { throw 'Distributionsname wurde ueberschrieben.' }
    if ((Get-Content -LiteralPath (Join-Path $root 'config\voice.json') -Raw) -notmatch 'piper') { throw 'Vorhandene Stimmkonfiguration wurde beschaedigt.' }
    if (-not (Test-Path -LiteralPath (Join-Path $root 'voice\partial\voice_persona.py'))) { throw 'Halb kopierte Datei wurde ohne Abschluss des Schritts entfernt.' }

    # --- Die teuren Schritte sind wiederholbar
    $rootScript = [IO.File]::ReadAllText((Join-Path $PSScriptRoot '..\wsl\setup_root.sh'))
    if ($rootScript -notmatch 'id "\$U" >/dev/null 2>&1 \|\| useradd') { throw 'setup_root.sh legt den Benutzer ohne Existenzpruefung an und scheitert bei der Wiederholung.' }
    if ($rootScript -notmatch 'mkdir -p /var/lib/systemd/linger') { throw 'setup_root.sh legt Verzeichnisse ohne -p an.' }
    $pairs = [IO.File]::ReadAllText((Join-Path $PSScriptRoot '..\voice\prepare_voice_pairs.py'))
    if ($pairs -notmatch 'if not target\.is_file\(\):') { throw 'Modellkopie in prepare_voice_pairs ueberschreibt vorhandene Dateien.' }
    if ($pairs -notmatch 'if source\.parent == package / "voice_models" and not canonical\.is_file\(\)') { throw 'prepare_voice_pairs ueberschreibt eine vorhandene Referenz.' }
    if ($ast.Extent.Text -notmatch 'Register-ScheduledTask -TaskName \$name[^)]*-Force') { throw 'Aufgabenregistrierung laeuft ohne -Force und scheitert bei der Wiederholung.' }

    Write-Host 'Wiederholbarkeit halb erledigter Schritte: PASS'
} finally {
    $resolved = [IO.Path]::GetFullPath($fixture)
    $tempRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\') + '\'
    if (-not $resolved.StartsWith($tempRoot, [StringComparison]::OrdinalIgnoreCase) -or
        -not ([IO.Path]::GetFileName($resolved)).StartsWith('friday-repeat-')) { throw "Unsicherer Testpfad: $resolved" }
    if (Test-Path -LiteralPath $resolved) { Remove-Item -LiteralPath $resolved -Recurse -Force }
}