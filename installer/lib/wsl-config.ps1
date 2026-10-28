# Globale .wslconfig: die Datei gilt fuer ALLE WSL-Distributionen des Benutzers (RAM, CPU, networkingMode).
# Eine vorhandene Datei traegt bewusst gesetzte globale Werte und bleibt deshalb unangetastet; ein globales
# `wsl --shutdown` laeuft nur, wenn keine fremde Distribution laeuft (I-004).

function Get-FridayWslConfigLines([int]$RamGb, [int]$Cores, [int]$Build) {
    $mem = [math]::Max(4, [math]::Min(16, [math]::Floor($RamGb / 2)))
    $cpu = [math]::Max(2, [math]::Min(10, $Cores - 2))
    $lines = @('[wsl2]', "memory=$($mem)GB", "processors=$cpu", 'swap=8GB', 'localhostForwarding=true')
    if ($Build -ge 22621) { $lines += @('networkingMode=mirrored', 'dnsTunneling=true', 'firewall=true') }
    $lines += @('', '[experimental]', 'autoMemoryReclaim=gradual')
    return [string[]]$lines
}

function Get-WslConfigPlan([string]$ConfigPath, $RunningDistros, [string]$Distro) {
    # Eine vorhandene globale Datei wird nie ueberschrieben: fremde Einstellungen waeren sonst weg.
    if (Test-Path -LiteralPath $ConfigPath) {
        return [pscustomobject]@{ Write = $false; Shutdown = $false; Reason = 'existing' }
    }
    # Unbekannter Zustand (Abruf fehlgeschlagen): nicht herunterfahren.
    if ($null -eq $RunningDistros) { return [pscustomobject]@{ Write = $true; Shutdown = $false; Reason = 'unknown' } }
    # Fremde laufende Distributionen wuerde ein globales `wsl --shutdown` mitbeenden.
    $others = @(@($RunningDistros) | Where-Object { $_ -and "$_".Trim() -and "$_".Trim() -ine $Distro })
    if ($others.Count -gt 0) {
        return [pscustomobject]@{ Write = $true; Shutdown = $false; Reason = 'others-running' }
    }
    return [pscustomobject]@{ Write = $true; Shutdown = $true; Reason = 'fresh' }
}

function Get-RunningWslDistros {
    # Nur die Namen laufender Distributionen; Fehler oder Zeitueberschreitung lassen den Zustand unbekannt.
    $run = Invoke-CapturedProcess -FilePath 'wsl.exe' -Arguments @('-l', '--running', '-q') -TimeoutSeconds 60
    if (-not $run -or -not $run.Started -or $run.TimedOut) { return $null }
    # Exitcode ungleich 0 heisst je nach WSL-Version nur "keine laufende Distribution"; Ausgabe trotzdem parsen.
    return ,@(("$($run.StdOut)" -split "`r?`n") | ForEach-Object { ("$_" -replace "`0", '').Trim() } | Where-Object { $_ })
}

