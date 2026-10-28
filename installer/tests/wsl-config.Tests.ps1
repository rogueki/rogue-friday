# Globale .wslconfig: eine vorhandene Datei bleibt unveraendert, und ein globales `wsl --shutdown` laeuft nur,
# wenn keine fremde Distribution laeuft. Geprueft werden die Helfer aus lib\wsl-config.ps1 und die
# Verdrahtung von Schritt 6 in install-friday.ps1.
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot '..\lib\wsl-config.ps1')
$script:checks = 0
function Assert-True([bool]$Condition, [string]$Label) {
    if (-not $Condition) { throw "Fehlgeschlagen: $Label" }
    $script:checks++
}
$installerSource = [IO.File]::ReadAllText((Join-Path $PSScriptRoot '..\install-friday.ps1'))
$tempDir = Join-Path ([IO.Path]::GetTempPath()) ("friday-wsl-config-" + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Force $tempDir | Out-Null
$existing = Join-Path $tempDir 'existing.wslconfig'
$missing = Join-Path $tempDir 'missing.wslconfig'
try {
    # --- vorhandene Datei: der Plan schreibt nicht, der Inhalt bleibt gleich
    [IO.File]::WriteAllText($existing, "[wsl2]`nmemory=3GB`n", (New-Object Text.UTF8Encoding $false))
    $hashBefore = (Get-FileHash -LiteralPath $existing -Algorithm SHA256).Hash
    $plan = Get-WslConfigPlan -ConfigPath $existing -RunningDistros @() -Distro 'FRIDAY-2'
    Assert-True (-not $plan.Write) 'vorhandene Datei: Write=false'
    Assert-True (-not $plan.Shutdown) 'vorhandene Datei: Shutdown=false'
    Assert-True ($plan.Reason -eq 'existing') 'vorhandene Datei: Reason=existing'
    $hashAfter = (Get-FileHash -LiteralPath $existing -Algorithm SHA256).Hash
    Assert-True ($hashBefore -eq $hashAfter) 'vorhandene Datei unveraendert (SHA-256 gleich)'

    # --- andere laufende Distribution: schreiben, aber nicht herunterfahren
    $plan = Get-WslConfigPlan -ConfigPath $missing -RunningDistros @('Ubuntu', 'FRIDAY-2') -Distro 'FRIDAY-2'
    Assert-True ($plan.Write) 'fremde Distribution laeuft: Write=true'
    Assert-True (-not $plan.Shutdown) 'fremde Distribution laeuft: Shutdown=false'
    Assert-True ($plan.Reason -eq 'others-running') 'fremde Distribution laeuft: Reason=others-running'

    # --- nur die eigene Distribution (andere Schreibweise, leerer Eintrag): Herunterfahren erlaubt
    $plan = Get-WslConfigPlan -ConfigPath $missing -RunningDistros @('friday-2', '') -Distro 'FRIDAY-2'
    Assert-True ($plan.Write) 'nur eigene Distribution: Write=true'
    Assert-True ($plan.Shutdown) 'nur eigene Distribution (case-insensitiv): Shutdown=true'

    # --- keine laufende Distribution
    $plan = Get-WslConfigPlan -ConfigPath $missing -RunningDistros @() -Distro 'FRIDAY-2'
    Assert-True ($plan.Shutdown) 'keine laufende Distribution: Shutdown=true'
    Assert-True ($plan.Reason -eq 'fresh') 'keine laufende Distribution: Reason=fresh'

    # --- unbekannter Zustand (Abruf fehlgeschlagen): schreiben, aber nie herunterfahren
    $plan = Get-WslConfigPlan -ConfigPath $missing -RunningDistros $null -Distro 'FRIDAY-2'
    Assert-True ($plan.Write) 'unbekannter Zustand: Write=true'
    Assert-True (-not $plan.Shutdown) 'unbekannter Zustand: Shutdown=false'
    Assert-True ($plan.Reason -eq 'unknown') 'unbekannter Zustand: Reason=unknown'

    # --- Zeilen: Rechenregeln und Build-Abhaengigkeit
    $lines = Get-FridayWslConfigLines -RamGb 32 -Cores 12 -Build 22631
    Assert-True ($lines -contains 'memory=16GB') '32 GB RAM: hoechstens 16 GB'
    Assert-True ($lines -contains 'processors=10') '12 Threads: hoechstens 10'
    Assert-True ($lines -contains 'networkingMode=mirrored') 'Build 22631: mirrored networking'
    $older = Get-FridayWslConfigLines -RamGb 32 -Cores 12 -Build 19045
    Assert-True (-not ($older -contains 'networkingMode=mirrored')) 'Build 19045: kein mirrored networking'

    # --- Verdrahtung in Schritt 6: Plan statt Ueberschreiben, Shutdown nur im eigenen Zweig
    Assert-True ($installerSource -match 'lib\\wsl-config\.ps1') 'install-friday.ps1 bindet das WSL-Konfigurationsmodul ein'
    $step6 = [regex]::Match($installerSource, '(?s)6 \.wslconfig.*?7 Ubuntu').Value
    Assert-True ($step6.Length -gt 0) 'Schritt 6 gefunden'
    Assert-True ($step6 -match 'Get-WslConfigPlan') 'Schritt 6 fragt den Plan ab'
    Assert-True (([regex]::Matches($step6, '--shutdown')).Count -eq 1) 'Schritt 6 ruft --shutdown genau einmal auf'
    $guard = $step6.IndexOf('if ($plan.Shutdown)')
    $call = $step6.IndexOf("'--shutdown'")
    Assert-True ($guard -ge 0 -and $call -gt $guard) '--shutdown steht nur im Shutdown-Zweig'
} finally {
    Remove-Item -LiteralPath $tempDir -Recurse -Force -ErrorAction SilentlyContinue
}
Write-Host "wsl-config: $script:checks Pruefungen bestanden."

