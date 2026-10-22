# WSL-Keepalive als echter Prozess, nicht als "bereit"-Aufgabe.
# Hintergrund (Regression 2026-10-21): Eine eingerichtete Aufgabe kann den Zustand "bereit" melden, ohne dass
# die WSL-VM wachgehalten wird. Die VM faehrt nach ~60 s Idle herunter und reisst den startenden TTS-Dienst mit.
# Deshalb zaehlt nur ein laufender Prozess `wsl.exe -d <Distro> ... sleep infinity`.

function Test-WslKeepaliveCommandLine([string]$CommandLine, [string]$Distro) {
    if (-not $CommandLine -or -not $Distro) { return $false }
    # WSL akzeptiert Distributionsnamen ohne Beachtung der Gross-/Kleinschreibung; ein anderer Name
    # (etwa eine fremde Distribution) darf nie als eigener Keepalive gelten.
    $distroPattern = '(?i)(?:^|\s)-d\s+"?' + [regex]::Escape($Distro) + '(?:"|\s|$)'
    if ($CommandLine -notmatch $distroPattern) { return $false }
    return ($CommandLine -match '(?i)sleep\s+infinity')
}

function Get-WslKeepaliveProcess([string]$Distro, [object[]]$Processes) {
    if ($null -eq $Processes) {
        $Processes = @(Get-CimInstance Win32_Process -Filter "Name='wsl.exe'" -ErrorAction SilentlyContinue)
    }
    return @($Processes | Where-Object { $_.CommandLine -and (Test-WslKeepaliveCommandLine ([string]$_.CommandLine) $Distro) })
}
