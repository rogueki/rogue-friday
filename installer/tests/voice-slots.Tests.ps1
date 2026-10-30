# Dritter Stimmplatz: Option 3 der Installerauswahl muss einen eigenen Platz belegen, und alle Stellen, die
# Stimmen aufzaehlen, muessen ihn kennen. Der Test ist strukturell - er prueft die Verdrahtung, nicht die
# Audioausgabe (dafuer braucht es GPU und laufenden Sprachdienst).
$ErrorActionPreference = 'Stop'
$installer = Join-Path $PSScriptRoot '..\install-friday.ps1'
$me = $PSScriptRoot

function Read-Text([string]$path) { [IO.File]::ReadAllText((Join-Path $me $path)) }

$script = [IO.File]::ReadAllText($installer)
# --- Auswahl und Abbildung
if ($script -notmatch '\$newChoice = if \(\$answer -eq ''2''\) \{ ''classic'' \} elseif \(\$answer -eq ''3''\) \{ ''custom'' \} else \{ ''friday-female'' \}') {
    throw 'Option 3 bildet nicht auf den eigenen Platz custom ab.'
}
if ($script -notmatch "\`$State\.voice_choice -notin @\('friday-female', 'classic', 'custom'\)") {
    throw 'Der Zustandscheck kennt custom nicht und wuerde die Auswahl zuruecksetzen.'
}
if ($script -notmatch "elseif \(\`$State\.voice_choice -eq 'custom'\) \{ '3' \}") {
    throw 'Die Standardauswahl kennt den eigenen Platz nicht.'
}
if ($script -notmatch "\`$ownReference = \(\`$newChoice -eq 'custom'\)") {
    throw 'Die eigene Referenz haengt nicht am eigenen Platz.'
}
if ($script -notmatch '\$pairs\.custom') {
    throw 'Der eigene Platz wird beim Vorbereiten der Paare nicht mitgegeben.'
}
if ($script -notmatch '\$State\["voice_reference_\$newChoice"\] = \$reference') {
    throw 'Die Referenz des eigenen Platzes wird nicht unter ihrem eigenen Schluessel gespeichert.'
}
if ($script -match "\`$State\['voice_reference_friday-female'\] =") {
    throw 'Eine feste Zuweisung auf den weiblichen Platz wuerde dessen Referenz ueberschreiben.'
}
# Die beiliegende Referenz darf fuer den eigenen Platz nicht als Kandidat auftauchen.
$findBlock = $script.Substring($script.IndexOf('function Find-VoiceReference'), 1200)
if ($findBlock -match "custom.*friday_ref|friday_ref.*custom") {
    throw 'Der eigene Platz bekommt eine Paket-Referenz, obwohl er nur aus der Aufnahme entstehen darf.'
}

# --- Python-Seite
$persona = Read-Text '..\voice\voice_persona.py'
if ($persona -notmatch 'CHOICES = \("friday-female", "classic", "custom"\)') { throw 'voice_persona kennt den dritten Platz nicht.' }
if ($persona -notmatch '"custom": "de_DE-kerstin-low"') { throw 'Dem eigenen Platz fehlt die Basisstimme.' }
$setup = Read-Text '..\voice\voice_setup.py'
if ($setup -notmatch 'choices=\("friday-female", "classic", "custom"\)') { throw 'voice_setup lehnt den eigenen Platz ab.' }
if ($setup -notmatch 'if options\.voice_choice in \("friday-female", "custom"\)') { throw 'voice_setup waehlt fuer den eigenen Platz keine Basisstimme.' }
$pairs = Read-Text '..\voice\prepare_voice_pairs.py'
if ($pairs -notmatch '"custom": \[reference_dir / "custom-reference\.wav"') { throw 'prepare_voice_pairs kennt die eigene Referenz nicht.' }
if ($pairs -match 'BUNDLED_REFERENCES = \{[^}]*"custom"') { throw 'Der eigene Platz hat eine Paket-Referenz.' }
$fast = Read-Text '..\fast_tts\server.py'
if ($fast -notmatch 'for choice in \("friday-female", "classic", "custom"\)') { throw 'Der TTS-Dienst liefert den eigenen Platz nicht.' }
$voice = Read-Text '..\voice\friday_voice.py'
if ($voice -notmatch 'body\["voice"\] not in CHOICES') { throw 'Der Stimm-Endpunkt prueft nicht gegen CHOICES.' }
$update = Read-Text '..\scripts\update-voice-personas.ps1'
if ($update -notmatch "\`$pairs = @\('friday-female','classic','custom'\)") { throw 'Das Stimmen-Update sichert den eigenen Platz nicht.' }

$installWsl = Read-Text '..\fast_tts\install_wsl.sh'
if ($installWsl -notmatch '\$# -ne 9' -or $installWsl -notmatch 'custom\) audio="\$8"; words="\$9"') { throw 'Die TTS-Installation legt den eigenen Platz nicht an.' }
$updateSh = Read-Text '..\fast_tts\update_personas.sh'
if ($updateSh -notmatch '\[\[ \$# -eq 7 \|\| \$# -eq 9 \]\]') { throw 'Das TTS-Update nimmt den eigenen Platz nicht an.' }
if ($update -match "'config\\voice-references\\classic-reference\.txt',\s*'config\\voice-references\\custom-streaming\.wav'") { throw 'Das Stimmen-Update uebergibt den eigenen Platz auch ohne Aufnahme.' }
$installer = Read-Text '..\install-friday.ps1'
if ($installer -notmatch '\$linuxPaths\.Count -in @\(7, 9\)') { throw 'Der Installer gibt die Stimmpaare bei eigener Aufnahme nicht weiter.' }

# --- Steuerungsseite
$repo = Join-Path $me '..\..'
$api = [IO.File]::ReadAllText((Join-Path $repo 'apps\control-api\src\services\voice-persona.ts'))
if ($api -notmatch 'export type VoicePersona = "friday-female" \| "classic" \| "custom";') { throw 'Die API kennt den eigenen Platz nicht.' }
if ($api -notmatch 'VOICE_PERSONAS: readonly VoicePersona\[\] = \["friday-female", "classic", "custom"\]') { throw 'VOICE_PERSONAS enthaelt den eigenen Platz nicht.' }
$settings = [IO.File]::ReadAllText((Join-Path $repo 'apps\control-api\src\services\settings.ts'))
if ($settings -notmatch 'VOICE_PERSONAS as readonly string\[\]\)\.includes') { throw 'Die installierte Stimme wird nicht gegen VOICE_PERSONAS geprueft.' }
if ($settings -match 'tts_voice_choice === "friday-female" \|\| value\.tts_voice_choice === "classic"') { throw 'Die installierte Stimme wird weiterhin gegen eine eigene Zwei-Werte-Liste geprueft.' }

Write-Host 'Dritter Stimmplatz: PASS'