# Start mit Administratorrechten und Abbruch der Windows-Abfrage.
# Ein Abbruch der UAC-Abfrage kommt als Win32-Fehler 1223 ("Der Vorgang wurde vom Benutzer abgebrochen")
# zurueck; er darf nicht als Programmfehler erscheinen und vor allem nichts am Zielordner aendern.

function Test-ElevationCanceled([System.Exception]$Exception) {
    $current = $Exception
    while ($current) {
        $native = $current -as [System.ComponentModel.Win32Exception]
        if ($native -and $native.NativeErrorCode -eq 1223) { return $true }
        if ($current.Message -match '(?i)(vom benutzer abgebrochen|the operation was canceled|operation was cancelled|canceled by the user|cancelled by the user)') { return $true }
        $current = $current.InnerException
    }
    return $false
}

function Start-ElevatedPowerShell([string]$ScriptPath, [string[]]$ForwardedArguments = @(), [switch]$Sta) {
    # ForwardedArguments sind bereits fertig zitierte Argumente; der Aufrufer entscheidet, was uebergeben wird.
    $arguments = @('-NoProfile')
    if ($Sta) { $arguments += '-STA' }
    $arguments += @('-ExecutionPolicy', 'Bypass', '-File', ('"' + $ScriptPath + '"'))
    $arguments += @($ForwardedArguments)
    try {
        Start-Process -FilePath 'powershell.exe' -ArgumentList ($arguments -join ' ') -Verb RunAs -ErrorAction Stop | Out-Null
        return @{ Started = $true; Canceled = $false; Message = '' }
    } catch {
        return @{
            Started  = $false
            Canceled = (Test-ElevationCanceled $_.Exception)
            Message  = $_.Exception.Message
        }
    }
}