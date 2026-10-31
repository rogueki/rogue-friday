# Klick-Bedienung des Assistenten: Freitext nur fuer Namen, Schluessel/Passwoerter und die Adresse eines eigenen
# Servers; alles andere per Auswahl, Haken oder Durchsuchen. Belegt aus dem Quelltext beider Seiten.
$ErrorActionPreference = 'Stop'
$gui = [IO.File]::ReadAllText((Join-Path $PSScriptRoot '..\install-friday-gui.ps1'))
$installer = [IO.File]::ReadAllText((Join-Path $PSScriptRoot '..\install-friday.ps1'))
$script:checks = 0
function Assert-True([bool]$Condition, [string]$Message) {
    $script:checks++
    if (-not $Condition) { throw $Message }
}

# --- 1. Freitextfelder: nur die erlaubten Namen
$allowedText = @('installRoot', 'distroLocation', 'voiceReference', 'elevenlabsKey', 'assistantName', 'wakePhrase',
                 'ownerName', 'modelBaseUrl', 'providerKey', 'linuxUser', 'linuxPassword', 'linuxPasswordRepeat', 'qwenAudioKey')
$textFields = @([regex]::Matches($gui, "Add-Row \`$[A-Za-z]+\.Panel '([A-Za-z]+)'") | ForEach-Object { $_.Groups[1].Value })
Assert-True ($textFields.Count -ge 10) "Nur $($textFields.Count) Textfelder gefunden; der Suchausdruck passt nicht mehr."
foreach ($name in $textFields) { Assert-True ($allowedText -contains $name) "Freitextfeld '$name' ist nicht erlaubt; Auswahl, Haken oder Durchsuchen verwenden." }
Assert-True ($textFields -notcontains 'about') 'Das Freitextfeld "Über dich" ist zurück.'

# --- 2. Pfade nur per Durchsuchen
foreach ($name in @('installRoot', 'distroLocation', 'voiceReference')) {
    Assert-True ($gui -match "Set-ReadOnlyPath \`$script:fields\.$name\b") "Pfadfeld '$name' ist beschreibbar."
}
Assert-True ($gui -match 'function Set-ReadOnlyPath[\s\S]{0,200}\.ReadOnly = \$true') 'Set-ReadOnlyPath setzt ReadOnly nicht.'
Assert-True (([regex]::Matches($gui, 'FolderBrowserDialog')).Count -ge 2) 'Installations- und WSL-Ordner brauchen je einen Ordnerdialog.'
Assert-True ($gui -match 'OpenFileDialog') 'Die Stimmreferenz braucht einen Dateidialog.'

# --- 3. Auswahlfelder
foreach ($name in @('distroName', 'voiceMode', 'voiceChoice', 'voiceId', 'inputDevice', 'outputDevice', 'address',
                    'character', 'length', 'providerChoice', 'alibabaRegion', 'modelName', 'conversationBackend', 'qwenRegion')) {
    Assert-True ($gui -match "Add-Choice \`$[A-Za-z]+\.Panel '$name'") "Auswahlfeld '$name' fehlt."
}
foreach ($label in @('OpenAI', 'Anthropic (Claude)', 'Alibaba Cloud Qwen (Token Plan)', 'Kimi Coding (Moonshot)', 'DeepSeek', 'OpenRouter')) {
    Assert-True ($gui.Contains("Label = '$label'")) "Anbieter '$label' fehlt in der Auswahl."
}
Assert-True ($gui -match 'token-plan\.ap-southeast-1\.maas\.aliyuncs\.com/compatible-mode/v1') 'Alibaba-Region International fehlt.'
Assert-True ($gui -match 'token-plan\.cn-beijing\.maas\.aliyuncs\.com/compatible-mode/v1') 'Alibaba-Region China fehlt.'
Assert-True ($gui -match "api\.elevenlabs\.io/v1/voices") 'ElevenLabs-Stimmen werden nicht aus dem Konto geladen.'

# --- 4. Pflichtangaben je Anbieter statt Kimi-Pflicht
Assert-True ($gui -notmatch "Kimi-API-Schlüssel fehlt") 'Der Kimi-Schlüssel ist wieder für jeden Anbieter Pflicht.'
Assert-True ($gui -match 'KeyLabel\) fehlt\.') 'Der Schlüssel des gewählten Anbieters wird nicht verlangt.'
Assert-True ($gui -match "Server-Adresse: vollständige URL") 'Die Adresse eines eigenen Servers wird nicht geprüft.'
foreach ($secret in @('openaiKey', 'anthropicKey', 'customKey', 'kimiKey', 'elevenlabsKey', 'qwenAudioKey', 'linuxPassword')) {
    Assert-True ($gui -match "\b$secret = ") "Zugangsdaten '$secret' fehlen im Übergabeobjekt."
}

# --- 5. Backend: GUI-Modus fragt nie im Terminal und laeuft nicht in Schleifen
$readHost = @([regex]::Matches($installer, '(?m)^.*Read-Host.*$') | ForEach-Object { $_.Value })
foreach ($line in $readHost) {
    Assert-True ($line -match 'GuiMode' -or $line -match '^\s*\$a = Read-Host "  \$question\$suffix"') "Read-Host ohne GUI-Zweig: $($line.Trim())"
}
Assert-True ($installer -match "if \(\`$GuiMode -and \`$baseUrl -notmatch '\^https\?://'\) \{ Stop-Install") 'Ungültige Server-Adresse führt im GUI-Modus zur Endlosschleife.'
Assert-True ($installer -match "if \(\`$GuiMode -and \`$answer -notin @\('1', '2', '3', '4'\)\)") 'Ungültige Anbieterwahl führt im GUI-Modus zur Endlosschleife.'
Assert-True ($installer -match "if \(\`$GuiMode\) \{\s+Stop-Install `"F\.R\.I\.D\.A\.Y\. ist auf diesem PC bereits") 'Zweite Installation hat keinen GUI-Zweig.'
Assert-True ($installer -match "'4' \{ 'kimi-coding' \}") 'Kimi Coding ist im Backend nicht wählbar.'
Assert-True ($installer -match "-notin @\('1','2','3','4'\)\) \{ throw 'Ungültige GUI-Auswahl: providerChoice' \}") 'Die Anbieterwahl der Oberfläche wird nicht geprüft.'

Write-Host "Klick-Bedienung: $($script:checks) Prüfungen bestanden"
Write-Host 'Klick-Bedienung: PASS'
