$ErrorActionPreference = 'Stop'
$installer = Join-Path $PSScriptRoot '..\install-friday.ps1'
$tokens = $null
$errors = $null
$ast = [System.Management.Automation.Language.Parser]::ParseFile($installer, [ref]$tokens, [ref]$errors)
if ($errors.Count) { throw "Installer hat PowerShell-Parserfehler: $($errors[0].Message)" }
$definition = $ast.Find({ param($node) $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq 'Find-VoiceReference' }, $true)
if (-not $definition) { throw 'Find-VoiceReference fehlt.' }
Invoke-Expression $definition.Extent.Text

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
    Write-Host 'Voice-Referenz Auswahl: PASS'
} finally {
    $resolvedFixture = [IO.Path]::GetFullPath($fixture)
    $tempRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\') + '\'
    if (-not $resolvedFixture.StartsWith($tempRoot, [StringComparison]::OrdinalIgnoreCase) -or
        -not ([IO.Path]::GetFileName($resolvedFixture)).StartsWith('friday-voice-reference-')) {
        throw "Unsicherer Testpfad: $resolvedFixture"
    }
    if (Test-Path -LiteralPath $resolvedFixture) { Remove-Item -LiteralPath $resolvedFixture -Recurse -Force }
}
