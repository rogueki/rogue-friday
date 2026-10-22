# Auswertung der wslpath-Antwort.
# Hintergrund (Regression 2026-10-21): wsl.exe stellt gelegentlich Warnzeilen voran ("wsl: ...", "Der Vorgang
# wurde erfolgreich beendet."). Wurde die erste Zeile ungeprueft als Pfad uebernommen, scheiterte der ganze
# Installationslauf an einem Pfad, der nie einer war. Deshalb: erst die vollstaendige Ausgabe auswerten, dann
# den Exitcode, und nur eine Zeile akzeptieren, die wirklich ein absoluter Linux-Pfad ist.

function Select-WslPathOutput([string[]]$Lines) {
    foreach ($line in @($Lines)) {
        if ($null -eq $line) { continue }
        $candidate = ([string]$line).Trim()
        if (-not $candidate) { continue }
        if (-not $candidate.StartsWith('/')) { continue }
        # Ein Pfad mit Nullbyte oder Zeilenumbruch ist keine gueltige Antwort.
        if ($candidate -match "[\x00\r\n]") { continue }
        return $candidate
    }
    return $null
}

function Split-WslOutput([string]$StdOut) {
    if (-not $StdOut) { return @() }
    return @($StdOut -split "`r?`n")
}