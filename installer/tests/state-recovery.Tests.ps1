# Prueft die Wiederherstellung des Installationszustands aus der Sicherung: eine unlesbare
# install-state.json darf den Fortschritt nicht stillschweigend auf null zuruecksetzen.
$ErrorActionPreference = 'Stop'
$installer = Join-Path $PSScriptRoot '..\install-friday.ps1'
$tokens = $null; $errors = $null
$ast = [System.Management.Automation.Language.Parser]::ParseFile($installer, [ref]$tokens, [ref]$errors)
if ($errors.Count) { throw "install-friday.ps1 hat Parserfehler: $($errors[0].Message)" }
foreach ($name in @('Read-InstallerState', 'Import-InstallerState', 'Save-State')) {
    $definition = $ast.Find({ param($node) $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq $name }, $true)
    if (-not $definition) { throw "$name fehlt." }
    Invoke-Expression $definition.Extent.Text
}

$fixture = Join-Path ([IO.Path]::GetTempPath()) ("friday-state-recovery-" + [guid]::NewGuid().ToString('N'))
try {
    New-Item -ItemType Directory -Force -Path $fixture | Out-Null
    $script:StateFile = Join-Path $fixture 'config\install-state.json'

    $missing = Import-InstallerState $script:StateFile
    if ($missing.State -or $missing.Source -or $missing.Damaged) { throw 'Fehlende Zustandsdatei liefert ein Ergebnis.' }

    $script:State = [ordered]@{ done = @('preflight', 'files'); voice_choice = 'classic' }
    Save-State
    $script:State.done = @('preflight', 'files', 'wslfeature', 'power')
    Save-State
    if (-not (Test-Path -LiteralPath "$($script:StateFile).bak" -PathType Leaf)) { throw 'Sicherung wurde nicht angelegt.' }
    if (Test-Path -LiteralPath "$($script:StateFile).tmp") { throw 'Temporaerdatei blieb liegen.' }

    $live = Import-InstallerState $script:StateFile
    if ($live.Source -ne 'live') { throw 'Lesbare Zustandsdatei wurde nicht direkt gelesen.' }
    if (@($live.State.done) -notcontains 'power') { throw 'Lesbare Zustandsdatei verliert Schritte.' }

    # Unlesbare Datei (abgeschnittenes JSON): Sicherung muss greifen und die Datei reparieren.
    [IO.File]::WriteAllText($script:StateFile, '{"done": ["preflight", ', (New-Object System.Text.UTF8Encoding($false)))
    $recovered = Import-InstallerState $script:StateFile
    if ($recovered.Source -ne 'backup') { throw 'Unlesbare Datei wurde nicht aus der Sicherung wiederhergestellt.' }
    if (@($recovered.State.done) -notcontains 'power') { throw 'Wiederhergestellter Zustand verliert Schritte.' }
    if ($recovered.Damaged -ne $script:StateFile) { throw 'Beschaedigte Datei wurde nicht benannt.' }
    $repaired = Get-Content -LiteralPath $script:StateFile -Raw -Encoding UTF8 | ConvertFrom-Json
    if (@($repaired.done) -notcontains 'power') { throw 'Reparierte Datei ist nicht der wiederhergestellte Zustand.' }

    # Gueltiges JSON ohne done[] ist ebenfalls kein brauchbarer Zustand.
    [IO.File]::WriteAllText($script:StateFile, '{"ohne":"done"}', (New-Object System.Text.UTF8Encoding($false)))
    $structural = Import-InstallerState $script:StateFile
    if ($structural.Source -ne 'backup') { throw 'JSON ohne done[] wurde als Fortschritt akzeptiert.' }

    # Ohne brauchbare Sicherung: kein stiller Neustart, sondern ein klares Ergebnis.
    [IO.File]::WriteAllText($script:StateFile, '{"done": [', (New-Object System.Text.UTF8Encoding($false)))
    [IO.File]::WriteAllText("$($script:StateFile).bak", 'kein json', (New-Object System.Text.UTF8Encoding($false)))
    $hopeless = Import-InstallerState $script:StateFile
    if ($hopeless.State) { throw 'Ohne brauchbare Sicherung wurde ein Zustand erfunden.' }
    if ($hopeless.Source) { throw 'Ohne brauchbare Sicherung wurde eine Quelle gemeldet.' }
    if ($hopeless.Damaged -ne $script:StateFile) { throw 'Ohne brauchbare Sicherung wurde die beschaedigte Datei nicht benannt.' }

    # Der Installer darf in diesem Fall nicht weiterlaufen, sondern muss mit Hinweis abbrechen.
    $body = Get-Content -LiteralPath $installer -Raw -Encoding UTF8
    if ($body -notmatch 'function Import-InstallerState') { throw 'Import-InstallerState fehlt im Installer.' }
    $loadBlock = $body.Substring($body.IndexOf('$ExistingState = Test-Path -LiteralPath $StateFile', [StringComparison]::Ordinal), 1200)
    if ($loadBlock -notmatch 'Import-InstallerState \$StateFile') { throw 'Der Installer nutzt die Wiederherstellung nicht.' }
    if ($loadBlock -notmatch 'Stop-Install "Der gespeicherte Fortschritt ist unlesbar') { throw 'Der Installer bricht bei unlesbarem Zustand ohne Hinweis ab.' }
    if ($loadBlock -notmatch "Source -eq 'backup'") { throw 'Der Installer meldet die Wiederherstellung nicht.' }

    Write-Host 'Zustandswiederherstellung: PASS'
} finally {
    $resolved = [IO.Path]::GetFullPath($fixture)
    $tempRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\') + '\'
    if (-not $resolved.StartsWith($tempRoot, [StringComparison]::OrdinalIgnoreCase) -or
        -not ([IO.Path]::GetFileName($resolved)).StartsWith('friday-state-recovery-')) { throw "Unsicherer Testpfad: $resolved" }
    if (Test-Path -LiteralPath $resolved) { Remove-Item -LiteralPath $resolved -Recurse -Force }
}