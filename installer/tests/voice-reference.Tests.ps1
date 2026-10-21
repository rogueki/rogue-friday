$ErrorActionPreference = 'Stop'
$installer = Join-Path $PSScriptRoot '..\install-friday.ps1'
$tokens = $null
$errors = $null
$ast = [System.Management.Automation.Language.Parser]::ParseFile($installer, [ref]$tokens, [ref]$errors)
if ($errors.Count) { throw "Installer hat PowerShell-Parserfehler: $($errors[0].Message)" }
$definition = $ast.Find({ param($node) $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq 'Find-VoiceReference' }, $true)
if (-not $definition) { throw 'Find-VoiceReference fehlt.' }
Invoke-Expression $definition.Extent.Text
$validator = $ast.Find({ param($node) $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq 'Test-VoiceReferenceFile' }, $true)
if (-not $validator) { throw 'Test-VoiceReferenceFile fehlt.' }
Invoke-Expression $validator.Extent.Text

function Write-TestWav([string]$Path, [double]$Seconds) {
    $rate = 16000; $channels = 1; $bits = 16
    $data = [int]($rate * $channels * ($bits / 8) * $Seconds)
    $writer = New-Object IO.BinaryWriter([IO.File]::Create($Path))
    try {
        $writer.Write([Text.Encoding]::ASCII.GetBytes('RIFF'))
        $writer.Write([int](36 + $data))
        $writer.Write([Text.Encoding]::ASCII.GetBytes('WAVEfmt '))
        $writer.Write([int]16)
        $writer.Write([int16]1)
        $writer.Write([int16]$channels)
        $writer.Write([int]$rate)
        $writer.Write([int]($rate * $channels * $bits / 8))
        $writer.Write([int16]($channels * $bits / 8))
        $writer.Write([int16]$bits)
        $writer.Write([Text.Encoding]::ASCII.GetBytes('data'))
        $writer.Write([int]$data)
        $writer.Write((New-Object byte[] $data))
    } finally { $writer.Dispose() }
}

$fixture = Join-Path ([IO.Path]::GetTempPath()) ("friday-voice-reference-" + [guid]::NewGuid().ToString('N'))
$package = Join-Path $fixture 'package'
$installed = Join-Path $fixture 'installed'
try {
    New-Item -ItemType Directory -Force (Join-Path $package 'voice_models') | Out-Null
    New-Item -ItemType Directory -Force (Join-Path $installed 'config\voice-references') | Out-Null
    $bundled = Join-Path $package 'voice_models\jarvis_ref.wav'
    Copy-Item -LiteralPath (Join-Path $PSScriptRoot '..\voice_models\jarvis_ref.wav') -Destination $bundled
    $found = Find-VoiceReference 'classic' '' $installed $package
    if ($found -ne $bundled) { throw 'Frische Installation verwendet die mitgelieferte J.A.R.V.I.S.-Stimme nicht.' }
    if ((Find-VoiceReference 'friday-female' '' $installed $package)) { throw 'J.A.R.V.I.S.-Referenz wurde der weiblichen Option zugeordnet.' }

    $existing = Join-Path $installed 'config\voice-references\classic-reference.wav'
    Copy-Item -LiteralPath $bundled -Destination $existing
    if ((Find-VoiceReference 'classic' '' $installed $package) -ne $existing) { throw 'Bestehende lokale Referenz hat keinen Vorrang.' }

    $saved = Join-Path $fixture 'selected.mp3'
    [IO.File]::WriteAllBytes($saved, [byte[]](1, 2, 3))
    if ((Find-VoiceReference 'classic' $saved $installed $package) -ne $saved) { throw 'Gespeicherte Referenz hat keinen Vorrang.' }
    if ((Find-VoiceReference 'classic' (Join-Path $fixture 'missing.wav') $installed $package) -ne $existing) { throw 'Ungueltiger Speicherpfad verhindert lokale Referenz.' }

    Remove-Item -LiteralPath $existing
    Remove-Item -LiteralPath $bundled
    if ((Find-VoiceReference 'classic' '' $installed $package)) { throw 'Fehlende Referenz wurde als vorhanden gemeldet.' }

    $good = Join-Path $fixture 'referenz.wav'; Write-TestWav $good 2.0
    $short = Join-Path $fixture 'kurz.wav'; Write-TestWav $short 0.2
    $empty = Join-Path $fixture 'leer.wav'; New-Item -ItemType File -Path $empty | Out-Null
    $broken = Join-Path $fixture 'kaputt.wav'; [IO.File]::WriteAllBytes($broken, (New-Object byte[] 4096))
    $ogg = Join-Path $fixture 'stimme.ogg'; [IO.File]::WriteAllBytes($ogg, (New-Object byte[] 4096))
    $mp3 = Join-Path $fixture 'referenz.mp3'
    [IO.File]::WriteAllBytes($mp3, ([Text.Encoding]::ASCII.GetBytes('ID3') + (New-Object byte[] 8192)))
    $fakeMp3 = Join-Path $fixture 'fake.mp3'; [IO.File]::WriteAllBytes($fakeMp3, (New-Object byte[] 8192))

    if (-not (Test-VoiceReferenceFile $good).Ok) { throw 'Gueltige WAV wurde abgelehnt.' }
    if (-not (Test-VoiceReferenceFile $mp3).Ok) { throw 'Gueltige MP3 wurde abgelehnt.' }
    if ((Test-VoiceReferenceFile $short).Ok) { throw 'Audio unter einer Sekunde wurde akzeptiert.' }
    if ((Test-VoiceReferenceFile $empty).Ok) { throw 'Leere Datei wurde akzeptiert.' }
    if ((Test-VoiceReferenceFile $broken).Ok) { throw 'Beschaedigter WAV-Kopf wurde akzeptiert.' }
    if ((Test-VoiceReferenceFile $ogg).Ok) { throw 'Fremde Endung wurde akzeptiert.' }
    if ((Test-VoiceReferenceFile $fakeMp3).Ok) { throw 'MP3 ohne Kopf wurde akzeptiert.' }
    if ((Test-VoiceReferenceFile (Join-Path $fixture 'weg.wav')).Ok) { throw 'Verschwundene Datei wurde akzeptiert.' }
    if ((Test-VoiceReferenceFile '').Ok) { throw 'Leerer Pfad wurde akzeptiert.' }
    if ((Test-VoiceReferenceFile $broken).Reason -eq '') { throw 'Ablehnung nennt keinen Grund.' }

    $guiText = [IO.File]::ReadAllText((Join-Path $PSScriptRoot '..\install-friday-gui.ps1'))
    if ($guiText -notmatch "'voiceChoice'[^\r\n]*'Eigene MP3/WAV \(3–30 s\)'") { throw 'GUI bietet die eigene Stimme nicht als dritte Option an.' }
    if ($guiText -notmatch 'Für die eigene Stimme wird eine MP3- oder WAV-Datei benötigt') { throw 'GUI verlangt keine Datei fuer die eigene Stimme.' }
    $installerText = [IO.File]::ReadAllText($installer)
    if ($installerText -notmatch "\`$answer -notin @\('1', '2', '3'\)") { throw 'Backend akzeptiert nicht alle drei Stimmen.' }
    if ($installerText -notmatch 'Test-VoiceReferenceFile \$reference') { throw 'Backend prueft die Referenzdatei nicht inhaltlich.' }

    Write-Host 'Voice-Referenz Auswahl und Dateipruefung: PASS'
} finally {
    $resolvedFixture = [IO.Path]::GetFullPath($fixture)
    $tempRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\') + '\'
    if (-not $resolvedFixture.StartsWith($tempRoot, [StringComparison]::OrdinalIgnoreCase) -or
        -not ([IO.Path]::GetFileName($resolvedFixture)).StartsWith('friday-voice-reference-')) {
        throw "Unsicherer Testpfad: $resolvedFixture"
    }
    if (Test-Path -LiteralPath $resolvedFixture) { Remove-Item -LiteralPath $resolvedFixture -Recurse -Force }
}