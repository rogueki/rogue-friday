# Drei lokale Stimmen in der GUI: Auswahl, Uebergabe an den Installer und Pflichtdatei fuer die eigene Stimme (N-002).
$ErrorActionPreference = 'Stop'
$guiFile = Join-Path $PSScriptRoot '..\\install-friday-gui.ps1'
$tokens = $null
$errors = $null
$ast = [System.Management.Automation.Language.Parser]::ParseFile($guiFile, [ref]$tokens, [ref]$errors)
if ($errors.Count) { throw "GUI hat PowerShell-Parserfehler: $($errors[0].Message)" }
$text = [IO.File]::ReadAllText($guiFile)

$choice = [regex]::Match($text, "Add-Choice \`$voicePage\.Panel 'voiceChoice' 'Lokale Ausgabestimme' \d+ @\((.*)\)\)")
if (-not $choice.Success) { throw 'Die Stimmauswahl fehlt.' }
$items = @([regex]::Matches($choice.Groups[1].Value, "'([^']*)'") | ForEach-Object { $_.Groups[1].Value })
if ($items.Count -ne 3) { throw "Die GUI bietet $($items.Count) statt drei Stimmen an." }
if ($items[2] -notmatch 'Eigene Stimme') { throw 'Die dritte Option ist nicht die eigene Stimme.' }
if ($text -notmatch "voiceChoice = \[string\]\(\`$script:fields\.voiceChoice\.SelectedIndex \+ 1\)") { throw 'Die GUI uebergibt die Stimmwahl nicht als 1 bis 3.' }
if ($text -notmatch "voice_choice -eq 'custom'\) \{ 2 \}") { throw 'Eine gespeicherte eigene Stimme wird beim Fortsetzen nicht wiederhergestellt.' }

$definition = $ast.Find({ param($node) $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq 'Test-VoiceReferenceAnswer' }, $true)
if (-not $definition) { throw 'Test-VoiceReferenceAnswer fehlt' }
Invoke-Expression $definition.Extent.Text
foreach ($reference in @('', '   ')) {
    $rejected = $false
    try { Test-VoiceReferenceAnswer 0 2 $reference } catch { $rejected = $_.Exception.Message -match 'eigene Stimme' }
    if (-not $rejected) { throw "Eigene Stimme ohne Datei ('$reference') wurde angenommen." }
}
Test-VoiceReferenceAnswer 0 2 'C:\Stimmen\eigen.wav'
Test-VoiceReferenceAnswer 0 0 ''
Test-VoiceReferenceAnswer 0 1 ''
Test-VoiceReferenceAnswer 1 2 ''
Write-Host 'PASS gui-voice-choice'
