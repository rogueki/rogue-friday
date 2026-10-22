# Quotierung von Pfaden: Zielordner mit &, %, ! und Umlauten sowie sehr lange Pfade muessen den Installer
# unveraendert erreichen. Geprueft werden der Batch-Argumenthelfer, die erzeugte resume.bat und zwei echte
# Laeufe am Einstiegspunkt.
$ErrorActionPreference = 'Stop'
$installer = Join-Path $PSScriptRoot '..\install-friday.ps1'
$tokens = $null; $errors = $null
$ast = [System.Management.Automation.Language.Parser]::ParseFile($installer, [ref]$tokens, [ref]$errors)
if ($errors.Count) { throw "install-friday.ps1 hat Parserfehler: $($errors[0].Message)" }
$definition = $ast.Find({ param($node) $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq 'ConvertTo-BatchArgument' }, $true)
if (-not $definition) { throw 'ConvertTo-BatchArgument fehlt.' }
Invoke-Expression $definition.Extent.Text

# --- Helfer
if ((ConvertTo-BatchArgument 'C:\a & b') -ne '"C:\a & b"') { throw 'Kaufmaennisches Und wurde veraendert.' }
if ((ConvertTo-BatchArgument 'C:\100% ready') -ne '"C:\100%% ready"') { throw "Prozentzeichen wurde nicht verdoppelt: $(ConvertTo-BatchArgument 'C:\100% ready')" }
if ((ConvertTo-BatchArgument 'C:\x\') -ne '"C:\x\."') { throw "Abschliessender Backslash wurde nicht entschaerft: $(ConvertTo-BatchArgument 'C:\x\')" }
if ((ConvertTo-BatchArgument 'C:\ü !wichtig!') -ne '"C:\ü !wichtig!"') { throw 'Umlaut oder Ausrufezeichen wurde veraendert.' }
if ((ConvertTo-BatchArgument '') -ne '""') { throw 'Leerer Wert ergibt kein leeres Argument.' }

function Invoke-InstallerRun([string]$TargetRoot, [string]$Tag, [string[]]$Extra = @()) {
    $stdout = Join-Path $fixture "$Tag.out.txt"
    $stderr = Join-Path $fixture "$Tag.err.txt"
    $arguments = "powershell.exe -NoProfile -ExecutionPolicy Bypass -File `"$installer`" -InstallRoot `"$TargetRoot`""
    foreach ($extra in $Extra) { $arguments += " $extra" }
    & cmd.exe /c "$arguments < nul > `"$stdout`" 2> `"$stderr`""
    return @{
        Code = $LASTEXITCODE
        Out  = (Get-Content -LiteralPath $stdout -Raw -Encoding UTF8 -ErrorAction SilentlyContinue)
        Err  = (Get-Content -LiteralPath $stderr -Raw -Encoding UTF8 -ErrorAction SilentlyContinue)
    }
}

$fixture = Join-Path ([IO.Path]::GetTempPath()) ("friday quoting-" + [guid]::NewGuid().ToString('N').Substring(0, 8))
try {
    New-Item -ItemType Directory -Force -Path $fixture | Out-Null
    $oddName = "Ziel & 100% !wichtig! ü'ordner"
    $oddRoot = Join-Path $fixture $oddName
    New-Item -ItemType Directory -Force -Path (Join-Path $oddRoot 'config') | Out-Null
    $location = Join-Path $fixture 'ablage & 50%'
    New-Item -ItemType Directory -Force -Path $location | Out-Null
    $state = [ordered]@{
        done            = @('preflight')
        distro_name     = 'FRIDAY-Test'
        distro_location = $location
        ports           = @{ Dashboard = 45201; Qwen = 45202; HermesApi = 45203; Voice = 45204; CommandCenter = 45210 }
        assistant_name  = 'Friday'
        wake_phrase     = 'Hey Friday'
    }
    [IO.File]::WriteAllText((Join-Path $oddRoot 'config\install-state.json'), ($state | ConvertTo-Json -Depth 5), (New-Object System.Text.UTF8Encoding($false)))

    # Lauf 1: der Abbruch schreibt resume.bat in den eigenen Ordner.
    $first = Invoke-InstallerRun -TargetRoot $oddRoot -Tag 'odd' -Extra @('-UpdateDashboard')
    if ($first.Code -ne 1) { throw "Lauf mit Sonderzeichen endete mit $($first.Code): $($first.Out) $($first.Err)" }
    if ($first.Out -notmatch 'unvollstaendig') { throw "Lauf mit Sonderzeichen erreichte die erwartete Pruefung nicht: $($first.Out)" }
    $bat = Join-Path $oddRoot 'resume.bat'
    if (-not (Test-Path -LiteralPath $bat)) { throw 'resume.bat wurde nicht geschrieben.' }
    $batText = Get-Content -LiteralPath $bat -Raw -Encoding UTF8
    if ($batText -notmatch 'cd /d "%~dp0"') { throw "resume.bat wechselt nicht in den eigenen Ordner: $batText" }
    if ($batText -notmatch '-InstallRoot "%CD%"') { throw "resume.bat uebergibt den Zielordner nicht aus dem eigenen Ordner: $batText" }
    if ($batText -match [regex]::Escape($oddName)) { throw 'resume.bat enthaelt den Sonderzeichenpfad woertlich und ist damit wieder exponiert.' }
    if ($batText -notmatch 'ablage & 50%%') { throw "Der Ablageort wurde in resume.bat nicht entschaerft: $batText" }
    if ($batText -notmatch 'chcp 65001') { throw 'resume.bat setzt die Codepage nicht.' }

    # Lauf 2: resume.bat selbst muss den Ordner unveraendert uebergeben. Ein leerer Ordner mit der Datei
    # darin endet sofort an der Leerpruefung, die den Pfad nennt - kein WSL, kein Zustand noetig.
    $copyRoot = Join-Path $fixture ("Kopie & 100% !x! ü'ordner")
    New-Item -ItemType Directory -Force -Path $copyRoot | Out-Null
    Copy-Item -LiteralPath $bat -Destination (Join-Path $copyRoot 'resume.bat')
    $stdout = Join-Path $fixture 'resume.out.txt'; $stderr = Join-Path $fixture 'resume.err.txt'
    & cmd.exe /c "`"$(Join-Path $copyRoot 'resume.bat')`" < nul > `"$stdout`" 2> `"$stderr`""
    $resumeCode = $LASTEXITCODE
    $resumeOut = (Get-Content -LiteralPath $stdout -Raw -Encoding UTF8 -ErrorAction SilentlyContinue) + (Get-Content -LiteralPath $stderr -Raw -Encoding UTF8 -ErrorAction SilentlyContinue)
    if ($resumeCode -ne 1) { throw "resume.bat endete mit $resumeCode statt 1: $resumeOut" }
    if ($resumeOut -notmatch [regex]::Escape("Kopie & 100% !x! ü'ordner")) { throw "resume.bat uebergab den Zielordner nicht unveraendert: $resumeOut" }
    if ($resumeOut -match 'C:\\Friday') { throw 'resume.bat fiel auf den Standardordner zurueck.' }

    # --- Sehr langer Pfad (LongPathsEnabled ist auf diesem Host aktiv)
    $longRoot = Join-Path $fixture ((('tiefes-verzeichnis-' + ('x' * 60) + '\')) * 2 + ('ziel-' + ('y' * 70)))
    try { New-Item -ItemType Directory -Force -Path $longRoot -ErrorAction Stop | Out-Null }
    catch { throw "Langer Pfad liess sich nicht anlegen: $($_.Exception.Message)" }
    if ($longRoot.Length -lt 260) { throw "Der Testpfad ist mit $($longRoot.Length) Zeichen nicht lang genug." }
    $long = Invoke-InstallerRun -TargetRoot $longRoot -Tag 'lang'
    if ($long.Code -ne 1) { throw "Lauf mit langem Pfad endete mit $($long.Code): $($long.Out)" }
    if ($long.Out -notmatch [regex]::Escape($longRoot)) { throw "Der lange Pfad kam nicht unveraendert an: $($long.Out)" }
    if (Test-Path -LiteralPath (Join-Path $longRoot 'run\installer.lock.json')) { throw 'Sperrdatei blieb im langen Pfad liegen.' }

    Write-Host 'Pfadquotierung: PASS'
} finally {
    $resolved = [IO.Path]::GetFullPath($fixture)
    $tempRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\') + '\'
    if (-not $resolved.StartsWith($tempRoot, [StringComparison]::OrdinalIgnoreCase) -or
        -not ([IO.Path]::GetFileName($resolved)).StartsWith('friday quoting-')) { throw "Unsicherer Testpfad: $resolved" }
    if (Test-Path -LiteralPath $resolved) { Remove-Item -LiteralPath $resolved -Recurse -Force }
}