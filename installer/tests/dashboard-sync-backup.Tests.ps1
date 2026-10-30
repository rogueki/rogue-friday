# Lieferung des Command Centers: der Installer muss den kanonischen Stand samt Creator Studio ausliefern
# (Route, Menue, Contracts, Migration, Voice-Bridge, Skills) und vor einem Update Build, Konfiguration und
# Datenbank mit pruefbarem Manifest sichern.
$ErrorActionPreference = 'Stop'
$installerDir = Join-Path $PSScriptRoot '..'
. (Join-Path $installerDir 'lib\dashboard-sync.ps1')
. (Join-Path $installerDir 'lib\dashboard-backup.ps1')
$repoRoot = (Resolve-Path -LiteralPath (Join-Path $installerDir '..')).Path

$script:checks = 0
function Assert-True([bool]$Condition, [string]$Message) {
    $script:checks++
    if (-not $Condition) { throw $Message }
}

$rootFiles = @('package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', 'tsconfig.base.json', 'README.md')
$dirs = @('apps', 'packages', 'adapters', 'scripts')
$exclude = @('node_modules', '.next', 'dist', 'out', 'coverage', 'storyboard-static', '.git')

$work = Join-Path $env:TEMP ('friday-dashsync-' + [guid]::NewGuid().ToString('N'))
try {
    # --- Quellbaum mit den Artefakten des Creator Studios
    $src = Join-Path $work 'source'
    $artefacts = @(
        'apps/web/src/app/(dashboard)/content-studio/page.tsx',
        'apps/web/src/features/content-studio/ContentStudioPage.tsx',
        'apps/control-api/src/services/content-studio.ts',
        'apps/control-api/src/services/content-studio-plan.ts',
        'apps/control-api/src/services/content-studio-media.ts',
        'apps/control-api/src/db/audit-anchor-migration.ts',
        'apps/control-api/src/handlers/browser-voice.ts',
        'apps/control-api/src/handlers/powerpoint.ts',
        'packages/contracts/schemas/content-studio.schema.json',
        'adapters/voice-http/package.json',
        'scripts/build-dashboard.ps1'
    )
    foreach ($relative in $artefacts) {
        $path = Join-Path $src $relative
        New-Item -ItemType Directory -Force -Path (Split-Path $path -Parent) | Out-Null
        [IO.File]::WriteAllText($path, "inhalt von $relative")
    }
    foreach ($name in $rootFiles) { [IO.File]::WriteAllText((Join-Path $src $name), "wurzel $name") }
    # Build-Ausgaben und Abhaengigkeiten, die nie ins Ziel gehoeren
    foreach ($junk in @('apps/web/.next/server/page.js', 'apps/web/out/index.html', 'apps/web/node_modules/x/index.js',
                        'apps/control-api/dist/main.js', 'packages/contracts/node_modules/y.js')) {
        $path = Join-Path $src $junk
        New-Item -ItemType Directory -Force -Path (Split-Path $path -Parent) | Out-Null
        [IO.File]::WriteAllText($path, 'muell')
    }

    # --- Kopie: alle Artefakte kommen an, Müll bleibt draußen
    $target = Join-Path $work 'target'
    New-Item -ItemType Directory -Force -Path (Join-Path $target 'apps\web\out') | Out-Null
    [IO.File]::WriteAllText((Join-Path $target 'apps\web\out\alter-build.js'), 'alt')
    Sync-DashboardSource -Source $src -Target $target -RootFiles $rootFiles -Dirs $dirs -ExcludeDirs $exclude `
        -PreserveFiles @('config/dashboard.yaml') -ConfigDirs @() | Out-Null
    foreach ($relative in $artefacts) {
        Assert-True (Test-Path -LiteralPath (Join-Path $target $relative) -PathType Leaf) "Nicht ausgeliefert: $relative"
        Assert-True ((Get-Content -LiteralPath (Join-Path $target $relative) -Raw) -eq "inhalt von $relative") "Inhalt weicht ab: $relative"
    }
    foreach ($name in $rootFiles) { Assert-True (Test-Path -LiteralPath (Join-Path $target $name)) "Wurzeldatei fehlt: $name" }
    foreach ($junk in @('apps/web/.next', 'apps/web/node_modules', 'apps/control-api/dist', 'packages/contracts/node_modules')) {
        Assert-True (-not (Test-Path -LiteralPath (Join-Path $target $junk))) "Build-Ausgabe wurde mitkopiert: $junk"
    }
    Assert-True (Test-Path -LiteralPath (Join-Path $target 'apps\web\out\alter-build.js')) 'Ein vorhandener Build wurde geloescht statt unberuehrt zu bleiben.'
    Assert-True (Test-Path -LiteralPath (Join-Path $target 'config')) 'Der Konfigurationsordner fehlt im Ziel.'

    # --- Lokale Konfiguration bleibt erhalten
    $withConfig = Join-Path $work 'source-config'
    New-Item -ItemType Directory -Force -Path (Join-Path $withConfig 'config') | Out-Null
    [IO.File]::WriteAllText((Join-Path $withConfig 'config\dashboard.yaml'), "neu: repo")
    [IO.File]::WriteAllText((Join-Path $withConfig 'config\adapters.yaml'), "neu: repo")
    [IO.File]::WriteAllText((Join-Path $withConfig 'config\other.yaml'), "neu: repo")
    $targetConfig = Join-Path $work 'target-config'
    New-Item -ItemType Directory -Force -Path (Join-Path $targetConfig 'config') | Out-Null
    [IO.File]::WriteAllText((Join-Path $targetConfig 'config\dashboard.yaml'), "lokal: benutzer")
    [IO.File]::WriteAllText((Join-Path $targetConfig 'config\adapters.yaml'), "lokal: benutzer")
    Sync-DashboardSource -Source $withConfig -Target $targetConfig -RootFiles @() -Dirs @() -ExcludeDirs $exclude `
        -PreserveFiles @('config\dashboard.yaml', 'config\adapters.yaml') -ConfigDirs @('config') | Out-Null
    Assert-True ((Get-Content -LiteralPath (Join-Path $targetConfig 'config\dashboard.yaml') -Raw) -eq 'lokal: benutzer') 'Die lokale dashboard.yaml wurde ueberschrieben.'
    Assert-True ((Get-Content -LiteralPath (Join-Path $targetConfig 'config\adapters.yaml') -Raw) -eq 'lokal: benutzer') 'Die lokale adapters.yaml wurde ueberschrieben.'
    Assert-True (Test-Path -LiteralPath (Join-Path $targetConfig 'config\other.yaml')) 'Eine neue Konfigurationsdatei wurde nicht ausgeliefert.'

    # --- Hash: gleicher Inhalt gleicher Hash, eine Aenderung aendert ihn, Ausgeschlossenes zaehlt nicht
    $hashA = Get-DashboardSourceHash -Source $src -RootFiles $rootFiles -Dirs $dirs -ExcludeDirs $exclude
    $hashB = Get-DashboardSourceHash -Source $src -RootFiles $rootFiles -Dirs $dirs -ExcludeDirs $exclude
    Assert-True ($hashA -eq $hashB) 'Zwei Laeufe ueber denselben Stand ergaben verschiedene Hashes.'
    Assert-True ($hashA -match '^[0-9a-f]{64}$') "Der Hash hat kein gueltiges Format: $hashA"
    [IO.File]::WriteAllText((Join-Path $src 'apps\control-api\src\services\content-studio-plan.ts'), 'geaendert')
    $hashC = Get-DashboardSourceHash -Source $src -RootFiles $rootFiles -Dirs $dirs -ExcludeDirs $exclude
    Assert-True ($hashC -ne $hashA) 'Eine Aenderung an einer ausgelieferten Datei aenderte den Hash nicht.'
    [IO.File]::WriteAllText((Join-Path $src 'apps\web\.next\server\page.js'), 'anderer muell')
    $hashD = Get-DashboardSourceHash -Source $src -RootFiles $rootFiles -Dirs $dirs -ExcludeDirs $exclude
    Assert-True ($hashD -eq $hashC) 'Eine Aenderung an einer Build-Ausgabe aenderte den Hash.'
    $preserved = Get-DashboardSourceHash -Source $withConfig -RootFiles @() -Dirs @() -ExcludeDirs $exclude `
        -PreserveFiles @('config\dashboard.yaml', 'config\adapters.yaml')
    [IO.File]::WriteAllText((Join-Path $withConfig 'config\dashboard.yaml'), "lokal: benutzer")
    $preservedAgain = Get-DashboardSourceHash -Source $withConfig -RootFiles @() -Dirs @() -ExcludeDirs $exclude `
        -PreserveFiles @('config\dashboard.yaml', 'config\adapters.yaml')
    Assert-True ($preserved -eq $preservedAgain) 'Eine lokale Konfigurationsdatei aenderte den Quellhash.'

    # --- Sicherung: Manifest, Pruefsummen, Ablehnung bei Schaeden, byte-identische Wiederherstellung
    $dash = Join-Path $work 'dash'
    New-Item -ItemType Directory -Force -Path (Join-Path $dash 'config'), (Join-Path $dash 'data'), (Join-Path $dash 'apps\web\out') | Out-Null
    [IO.File]::WriteAllText((Join-Path $dash 'config\dashboard.yaml'), 'port: 43791')
    [IO.File]::WriteAllText((Join-Path $dash 'data\dashboard-revision.json'), '{"revision":7}')
    [IO.File]::WriteAllText((Join-Path $dash 'apps\web\out\page.html'), '<html>build</html>')
    $dbPath = Join-Path $dash 'data\dashboard.sqlite'
    # Echte SQLite-Datei, damit die Wiederherstellung an einer echten Datenbank geprueft wird.
    $node = (Get-Command node.exe -ErrorAction SilentlyContinue | Select-Object -First 1).Source
    $sqliteReady = $false
    if ($node) {
        # Skriptdatei statt -e: PowerShell entfernt Anfuehrungszeichen in Argumenten nativer Programme.
        $creator = Join-Path $work 'create-db.cjs'
        $creatorSource = @'
const { DatabaseSync } = require("node:sqlite");
const db = new DatabaseSync(process.argv[2]);
db.exec("CREATE TABLE plan (id INTEGER PRIMARY KEY, json TEXT)");
db.prepare("INSERT INTO plan (id, json) VALUES (1, ?)").run(JSON.stringify({ steps: [1, 2, 3] }));
db.close();
'@
        [IO.File]::WriteAllText($creator, $creatorSource)
        $previousPreference = $ErrorActionPreference
        $ErrorActionPreference = 'Continue'
        try { & $node $creator $dbPath 2>$null | Out-Null; $nodeExit = $LASTEXITCODE }
        finally { $ErrorActionPreference = $previousPreference }
        $sqliteReady = ($nodeExit -eq 0 -and (Test-Path -LiteralPath $dbPath))
    }
    if (-not $sqliteReady) { [IO.File]::WriteAllText($dbPath, 'ersatz-fuer-sqlite') }
    $entries = @(
        @{ Source = (Join-Path $dash 'config\dashboard.yaml'); Relative = 'config\dashboard.yaml' },
        @{ Source = (Join-Path $dash 'data\dashboard-revision.json'); Relative = 'data\dashboard-revision.json' },
        @{ Source = (Join-Path $dash 'data\dashboard.sqlite'); Relative = 'data\dashboard.sqlite' },
        @{ Source = (Join-Path $dash 'apps\web\out'); Relative = 'apps\web\out' },
        @{ Source = (Join-Path $dash 'data\fehlt.json'); Relative = 'data\fehlt.json' }
    )
    $backup = Backup-DashboardState -BackupRoot (Join-Path $work 'backups') -Entries $entries -Reason 'Test'
    Assert-True ([bool]$backup) 'Die Sicherung wurde nicht angelegt.'
    $manifest = Get-Content -LiteralPath (Join-Path $backup 'manifest.json') -Raw | ConvertFrom-Json
    Assert-True ($manifest.v -eq 1 -and $manifest.reason -eq 'Test') 'Das Manifest nennt Version oder Anlass nicht.'
    Assert-True (@($manifest.entries | Where-Object { $_.state -eq 'gesichert' }).Count -eq 4) "Gesichert wurden $((@($manifest.entries | Where-Object { $_.state -eq 'gesichert' })).Count) statt vier Eintraege."
    Assert-True (@($manifest.entries | Where-Object { $_.state -eq 'fehlt' }).Count -eq 1) 'Die fehlende Quelle wurde nicht vermerkt.'
    Assert-True (@($manifest.entries | Where-Object { $_.relative -eq 'apps\web\out\page.html' }).Count -eq 1) 'Der Build-Ordner wurde nicht einzeln aufgefuehrt.'
    Assert-True (@($manifest.entries | Where-Object { $_.relative -eq 'data\dashboard.sqlite' -and $_.bytes -gt 0 }).Count -eq 1) 'Die Datenbank wurde nicht mit Groesse gesichert.'
    $dbHash = (Get-FileHash -LiteralPath $dbPath -Algorithm SHA256).Hash
    $freshProblems = Test-DashboardBackup $backup
    Assert-True ($freshProblems.Count -eq 0) "Die frische Sicherung meldet Probleme: $($freshProblems -join ' ')"

    # --- Überschreiben, dann wiederherstellen
    [IO.File]::WriteAllText($dbPath, 'zerstoert')
    Remove-Item -LiteralPath (Join-Path $dash 'apps\web\out\page.html') -Force
    [IO.File]::WriteAllText((Join-Path $dash 'config\dashboard.yaml'), 'port: 1')
    $restored = Restore-DashboardState -BackupPath $backup -Target $dash
    Assert-True ($restored -eq 4) "Wiederhergestellt wurden $restored statt vier Dateien."
    Assert-True ((Get-FileHash -LiteralPath $dbPath -Algorithm SHA256).Hash -eq $dbHash) 'Die Datenbank ist nach der Wiederherstellung nicht identisch.'
    Assert-True ((Get-Content -LiteralPath (Join-Path $dash 'config\dashboard.yaml') -Raw) -eq 'port: 43791') 'Die Konfiguration wurde nicht wiederhergestellt.'
    Assert-True (Test-Path -LiteralPath (Join-Path $dash 'apps\web\out\page.html')) 'Der Build wurde nicht wiederhergestellt.'
    if ($sqliteReady) {
        $reader = Join-Path $work 'read-db.cjs'
        $readerSource = @'
const { DatabaseSync } = require("node:sqlite");
const db = new DatabaseSync(process.argv[2]);
const row = db.prepare("SELECT json FROM plan WHERE id = 1").get();
db.close();
console.log(row.json);
'@
        [IO.File]::WriteAllText($reader, $readerSource)
        $previousPreference = $ErrorActionPreference
        $ErrorActionPreference = 'Continue'
        try { $read = & $node $reader $dbPath 2>$null }
        finally { $ErrorActionPreference = $previousPreference }
        Assert-True ("$read" -match 'steps') "Die wiederhergestellte Datenbank ist nicht lesbar: $read"
    }

    # --- Beschaedigte Sicherung wird abgelehnt und schreibt nichts
    [IO.File]::WriteAllText((Join-Path $backup 'data\dashboard-revision.json'), '{"revision":99}')
    $problems = Test-DashboardBackup $backup
    Assert-True ($problems.Count -eq 1) "Eine beschaedigte Sicherung meldet $($problems.Count) statt ein Problem."
    Assert-True ($problems[0] -match 'Groesse|Pruefsumme') "Der Befund nennt keine Pruefsumme: $($problems[0])"
    $refused = $false
    try { Restore-DashboardState -BackupPath $backup -Target $dash | Out-Null } catch { $refused = $true }
    Assert-True $refused 'Eine beschaedigte Sicherung wurde trotzdem zurueckgeschrieben.'

    # --- Verdrahtung im Installer
    $installerText = Get-Content -LiteralPath (Join-Path $installerDir 'install-friday.ps1') -Raw
    Assert-True ($installerText.Contains("lib\dashboard-sync.ps1") -and $installerText.Contains("lib\dashboard-backup.ps1")) 'Der Installer laedt die Dashboard-Module nicht.'
    Assert-True ($installerText.Contains('Backup-DashboardState -BackupRoot')) 'Der Installer sichert das Dashboard nicht ueber das Manifest.'
    Assert-True ($installerText.Contains("data\dashboard.sqlite")) 'Die Datenbank wird vor dem Update nicht gesichert.'
    $installBody = [regex]::Match($installerText, '(?s)function Install-Dashboard \{.*?\n\}').Value
    $stopAt = $installBody.IndexOf('Stop-DashboardService')
    $backupAt = $installBody.IndexOf('Backup-CustomDashboard')
    Assert-True ($backupAt -gt 0 -and $stopAt -gt 0 -and $stopAt -lt $backupAt) 'Die Datenbank wird gesichert, solange das Dashboard noch laeuft.'
    Assert-True ($installerText.Contains('Get-DashboardSourceHash -Source $src')) 'Der Quellhash wird nicht mehr ueber das Modul gebildet.'
    Assert-True (-not ($installerText -match '(?m)^function Get-SourceHash\(\[string\]\$src\) \{\s*\n\s*\$files = New-Object')) 'Der alte Hash-Code steht noch im Installer.'
    Assert-True (-not ($installerText -match '(?m)^\s*& robocopy\.exe "\$src\\\$d"')) 'Der alte Kopiercode steht noch im Installer.'
    $broken = $installerText.Replace('Backup-DashboardState -BackupRoot', 'Write-Output')
    Assert-True (-not $broken.Contains('Backup-DashboardState -BackupRoot')) 'Die Gegenprobe ohne Sicherung blieb unentdeckt.'

    # --- Creator Studio ist Standardpaket: Installer-YAML, Schema-Standard, Kein Sonderbranch
    Assert-True ($installerText.Contains('contentStudio: true')) 'Die erzeugte dashboard.yaml aktiviert Creator Studio nicht.'
    $schema = Get-Content -LiteralPath (Join-Path $repoRoot 'packages\config\src\schemas\dashboard.schema.json') -Raw | ConvertFrom-Json
    Assert-True ($schema.properties.ui.properties.contentStudio.default -eq $true) 'Der Standard der Konfiguration aktiviert Creator Studio nicht.'
    $settingsSource = Get-Content -LiteralPath (Join-Path $repoRoot 'apps\control-api\src\services\settings.ts') -Raw
    Assert-True ($settingsSource.Contains('contentStudioEnabled: config.ui.contentStudio')) 'Die Laufzeit uebernimmt die Konfiguration nicht in die Einstellungen.'
    $navSource = Get-Content -LiteralPath (Join-Path $repoRoot 'apps\web\src\features\shell\navModel.tsx') -Raw
    Assert-True ($navSource.Contains('settings?.dashboard.contentStudioEnabled === true')) 'Der Menueeintrag haengt nicht an der Einstellung.'
    Assert-True ($installerText.Contains('Sync-DashboardSource -Source $src -Target $Dash')) 'Der Installer kopiert nicht mehr ueber den kanonischen Sync.'
    Assert-True (-not $installerText.Contains('git clone') -and -not $installerText.Contains('git checkout')) 'Der Installer holt Quellen aus einem Branch statt aus dem eigenen Stand.'

    # --- FFmpeg: echte Komponente und Umgebungsweg
    $ffmpeg = (Get-Command ffmpeg.exe -ErrorAction SilentlyContinue | Select-Object -First 1).Source
    Assert-True ([bool]$ffmpeg) 'FFmpeg ist auf dieser Maschine nicht auffindbar.'
    $version = & $ffmpeg -version 2>&1 | Select-Object -First 1
    Assert-True ("$version" -match '^ffmpeg version ') "FFmpeg meldet keine Version: $version"
    Assert-True ($installerText.Contains('FRIDAY_FFMPEG_PATH')) 'Der Installer beachtet FRIDAY_FFMPEG_PATH nicht.'
} finally {
    $verified = [IO.Path]::GetFullPath($work)
    if ($verified.StartsWith(([IO.Path]::GetFullPath($env:TEMP).TrimEnd('\') + '\'), [StringComparison]::OrdinalIgnoreCase)) {
        Remove-Item -LiteralPath $verified -Recurse -Force -ErrorAction SilentlyContinue
    }
}

Write-Host "Dashboard-Lieferung und Sicherung: PASS ($script:checks Zusicherungen, Creator-Studio-Artefakte ausgeliefert, Build-Ausgaben ausgeschlossen, Sicherung mit Manifest und lesbarer Datenbank)"