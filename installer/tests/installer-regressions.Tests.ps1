# Installerregressionen einzeln pruefen: kein voller Installationslauf, sondern je Fehlerzustand eine Probe.
# Geprueft werden die Bausteine, die der Installer benutzt, plus die Verdrahtung im Installer selbst.
$ErrorActionPreference = 'Stop'
$installerDir = Join-Path $PSScriptRoot '..'
. (Join-Path $installerDir 'lib\wait-http.ps1')
. (Join-Path $installerDir 'lib\wsl-keepalive.ps1')
. (Join-Path $installerDir 'lib\download-integrity.ps1')
. (Join-Path $installerDir 'lib\wsl-path.ps1')

$script:checks = 0
function Assert-True([bool]$Condition, [string]$Message) {
    $script:checks++
    if (-not $Condition) { throw $Message }
}
function Wait-Until([scriptblock]$Condition, [int]$Milliseconds = 5000) {
    $until = (Get-Date).AddMilliseconds($Milliseconds)
    while ((Get-Date) -lt $until) { if (& $Condition) { return $true }; Start-Sleep -Milliseconds 100 }
    return [bool](& $Condition)
}

# --- Ein kleiner HTTP-Server auf 127.0.0.1, der je nach Auftrag 503 oder 200 liefert
function Start-ProbeServer([scriptblock]$Responder) {
    # Freien Port nur mit einem TCP-Horchversuch ermitteln und sofort freigeben: ein im Elternprozess
    # gestarteter HttpListener wuerde die Adresse belegen und der Job koennte nicht binden.
    $port = 0
    foreach ($candidate in 18711..18719) {
        $probe = $null
        try {
            $probe = New-Object Net.Sockets.TcpListener([Net.IPAddress]::Loopback, $candidate)
            $probe.Start()
            $port = $candidate
            break
        } catch {
        } finally {
            if ($probe) { $probe.Stop() }
        }
    }
    if (-not $port) { throw 'Kein freier Probeport gefunden.' }
    $script:probeState = [ordered]@{ Requests = 0; Errors = $null }
    $job = Start-Job -ArgumentList $port, $Responder.ToString(), $null -ScriptBlock {
        param($port, $responderText, $unused)
        $listener = New-Object Net.HttpListener
        $listener.Prefixes.Add("http://127.0.0.1:$port/")
        $listener.Start()
        $script:count = 0
        $responder = [scriptblock]::Create($responderText)
        while ($listener.IsListening) {
            try {
                $context = $listener.GetContext()
                $script:count++
                $status = & $responder $script:count
                $context.Response.StatusCode = [int]$status
                $payload = [Text.Encoding]::UTF8.GetBytes('{"ok":false}')
                $context.Response.ContentLength64 = $payload.Length
                $context.Response.OutputStream.Write($payload, 0, $payload.Length)
                $context.Response.OutputStream.Close()
            } catch { break }
        }
        $listener.Stop()
    }
    return [ordered]@{ Port = $port; Url = "http://127.0.0.1:$port/health"; Job = $job }
}

$servers = @()
try {
    # --- 1) 503 ist Laden, nicht Fehler: 503 zweimal, dann 200
    $server = Start-ProbeServer { param($count) if ($count -le 3) { 503 } else { 200 } }
    $servers += $server.Job
    $ok = Wait-Until { (Invoke-HttpProbe -Url $server.Url).Classification -ne 'unreachable' } 8000
    Assert-True $ok 'Der Probeserver antwortet nicht.'
    $first = Invoke-HttpProbe -Url $server.Url
    Assert-True ($first.Classification -eq 'loading' -and $first.StatusCode -eq 503) "503 wurde als '$($first.Classification)' statt 'loading' gedeutet."
    $result = Wait-HttpEndpoint -Url $server.Url -Seconds 30 -PollSeconds 1
    Assert-True $result.Ok 'Der Dienst wurde trotz spaeterer 200-Antwort nicht als bereit erkannt.'
    Assert-True ($result.Loading -ge 1) 'Die 503-Antworten wurden nicht als Laden gezaehlt.'
    Assert-True ($result.Attempts -ge 2) "Es wurden nur $($result.Attempts) Versuche gezaehlt."

    # --- 2) Dienst, der nur 503 liefert: Abbruch mit "loading", nicht "unreachable"
    $onlyLoading = Start-ProbeServer { param($count) 503 }
    $servers += $onlyLoading.Job
    $ready = Wait-Until { (Invoke-HttpProbe -Url $onlyLoading.Url).Classification -eq 'loading' } 8000
    Assert-True $ready 'Der 503-Server antwortet nicht.'
    $stuck = Wait-HttpEndpoint -Url $onlyLoading.Url -Seconds 3 -PollSeconds 1
    Assert-True (-not $stuck.Ok) 'Ein dauerhaft ladender Dienst galt als bereit.'
    Assert-True ($stuck.Classification -eq 'loading') "Der Befund lautet '$($stuck.Classification)' statt 'loading'."
    Assert-True ($stuck.Loading -ge 1) 'Die Ladephase wurde nicht gezaehlt.'

    # --- 3) Nichts hoert auf dem Port: "unreachable", klar getrennt von Laden
    $closed = Invoke-HttpProbe -Url 'http://127.0.0.1:18799/health' -TimeoutMilliseconds 500
    Assert-True ($closed.Classification -eq 'unreachable' -and $closed.StatusCode -eq 0) "Ein geschlossener Port wurde als '$($closed.Classification)' gedeutet."
    $timeout = Wait-HttpEndpoint -Url 'http://127.0.0.1:18799/health' -Seconds 2 -PollSeconds 1
    Assert-True (-not $timeout.Ok -and $timeout.Classification -eq 'unreachable') 'Ein geschlossener Port galt als erreichbar.'
    Assert-True ($timeout.Seconds -ge 2) "Das Zeitfenster von 2 s wurde nicht eingehalten ($($timeout.Seconds) s)."

    # --- 4) Abbruchbitte waehrend des Wartens wird beachtet
    $cancelled = $false
    $thrown = $false
    try {
        Wait-HttpEndpoint -Url 'http://127.0.0.1:18799/health' -Seconds 30 -PollSeconds 1 -CancelCheck { if (-not $script:cancelSeen) { $script:cancelSeen = $true; throw 'Abbruch' } }
    } catch { $thrown = $true }
    $cancelled = $thrown
    Assert-True $cancelled 'Die Abbruchbitte wurde waehrend des Wartens nicht beachtet.'

    # --- 5) Keepalive: nur ein echter wsl.exe-Prozess mit sleep infinity zaehlt
    $distro = 'FRIDAY-2'
    Assert-True (Test-WslKeepaliveCommandLine 'wsl.exe -d FRIDAY-2 --exec /bin/sleep infinity' $distro) 'Der echte Keepalive wurde nicht erkannt.'
    Assert-True (Test-WslKeepaliveCommandLine 'C:\Windows\System32\wsl.exe -d friday-2 -u root --exec /bin/sleep infinity' $distro) 'Der Keepalive mit Kleinschreibung wurde nicht erkannt.'
    Assert-True (-not (Test-WslKeepaliveCommandLine 'wsl.exe -d UBUNTU --exec /bin/sleep infinity' $distro)) 'Ein Keepalive einer fremden Distribution galt als eigener.'
    Assert-True (-not (Test-WslKeepaliveCommandLine 'wsl.exe -d FRIDAY-2 --exec /bin/sleep 30' $distro)) 'Ein kurzes sleep galt als Keepalive.'
    Assert-True (-not (Test-WslKeepaliveCommandLine 'wsl.exe -d FRIDAY-21 --exec /bin/sleep infinity' $distro)) 'Eine Distribution mit gleichem Praefix galt als Treffer.'
    Assert-True (-not (Test-WslKeepaliveCommandLine '' $distro)) 'Eine leere Befehlszeile galt als Keepalive.'
    $processes = @(
        [pscustomobject]@{ Name = 'wsl.exe'; CommandLine = 'wsl.exe -d UBUNTU --exec /bin/sleep infinity' },
        [pscustomobject]@{ Name = 'wsl.exe'; CommandLine = 'wsl.exe -d FRIDAY-2 -u root --exec /bin/sleep infinity' },
        [pscustomobject]@{ Name = 'wsl.exe'; CommandLine = 'wsl.exe -d FRIDAY-2 --status' }
    )
    $found = @(Get-WslKeepaliveProcess -Distro $distro -Processes $processes)
    Assert-True ($found.Count -eq 1) "Gefunden wurden $($found.Count) statt genau ein Keepalive-Prozess."
    Assert-True (@(Get-WslKeepaliveProcess -Distro 'FRIDAY-9' -Processes $processes).Count -eq 0) 'Ohne passenden Prozess wurde trotzdem ein Keepalive gemeldet.'

    # --- 6) Pruefsummen: stimmende Datei bleibt, falsche wird geloescht
    $dir = Join-Path $env:TEMP ('friday-hash-' + [guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Path $dir -Force | Out-Null
    $file = Join-Path $dir 'modell.gguf'
    [IO.File]::WriteAllText($file, 'probe-inhalt')
    $hash = Get-FileSha256 $file
    Assert-True ($hash -match '^[0-9a-f]{64}$') "Der Pruefsummenwert hat kein gueltiges Format: $hash"
    Assert-True (Test-FileSha256 $file $hash) 'Die eigene Pruefsumme wurde nicht erkannt.'
    Assert-True (Test-FileSha256 $file $hash.ToUpperInvariant()) 'Eine Pruefsumme in Grossbuchstaben wurde nicht erkannt.'
    Assert-True (Test-FileSha256 $file ("sha256:" + $hash)) 'Eine Pruefsumme mit Praefix wurde nicht erkannt.'
    Assert-True (Assert-FileSha256 $file $hash 'Probe') 'Eine stimmige Datei wurde abgelehnt.'
    Assert-True (Test-Path -LiteralPath $file) 'Eine stimmige Datei wurde geloescht.'
    Assert-True (-not (Assert-FileSha256 $file ('0' * 64) 'Probe')) 'Eine falsche Datei galt als stimmig.'
    Assert-True (-not (Test-Path -LiteralPath $file)) 'Eine falsche Datei blieb liegen.'
    Assert-True ($null -eq (Get-FileSha256 (Join-Path $dir 'fehlt.gguf'))) 'Eine fehlende Datei lieferte eine Pruefsumme.'

    # --- 6b) wslpath: Warnzeilen werden gefiltert, der Pfad kommt vollstaendig an
    Assert-True ((Select-WslPathOutput @('wsl: Warnung: Der Vorgang wurde erfolgreich beendet.', '/mnt/c/Friday')) -eq '/mnt/c/Friday') 'Der Pfad hinter einer Warnzeile wurde nicht gefunden.'
    Assert-True ((Select-WslPathOutput @('/mnt/d/Mein Ordner/Friday')) -eq '/mnt/d/Mein Ordner/Friday') 'Ein Pfad mit Leerzeichen wurde beschaedigt.'
    Assert-True ((Select-WslPathOutput @('', '  /mnt/c/Friday  ')) -eq '/mnt/c/Friday') 'Ein Pfad mit Leerraum wurde nicht bereinigt.'
    Assert-True ($null -eq (Select-WslPathOutput @('wsl: Fehler', 'Der Vorgang wurde erfolgreich beendet.'))) 'Eine Antwort ohne Pfad wurde als Pfad gedeutet.'
    Assert-True ($null -eq (Select-WslPathOutput @())) 'Eine leere Antwort lieferte einen Pfad.'
    Assert-True ($null -eq (Select-WslPathOutput @('C:\Friday'))) 'Ein Windows-Pfad galt als Linux-Pfad.'
    Assert-True (@(Split-WslOutput "a`r`nb`nc").Count -eq 3) 'Die Ausgabe wurde nicht in Zeilen getrennt.'
    Assert-True (@(Split-WslOutput '').Count -eq 0) 'Eine leere Ausgabe ergab Zeilen.'
    $pathSource = Get-Content -LiteralPath (Join-Path $installerDir 'install-friday.ps1') -Raw
    $selectAt = $pathSource.IndexOf('Select-WslPathOutput (Split-WslOutput')
    $exitAt = $pathSource.IndexOf('if ($run.ExitCode -ne 0 -or -not $linuxPath)')
    Assert-True ($selectAt -gt 0 -and $exitAt -gt $selectAt) 'Die Ausgabe wird nicht vor dem Exitcode ausgewertet.'

    # --- 6c) Kindprozess-PATH: ein zitierter PATH-Eintrag verdeckt node.exe fuer cmd, die Korrektur behebt das
    $nodeExe = (Get-Command node.exe -ErrorAction SilentlyContinue | Select-Object -First 1).Source
    if (-not $nodeExe) { $nodeExe = "$env:ProgramFiles\nodejs\node.exe" }
    Assert-True (Test-Path -LiteralPath $nodeExe) 'node.exe ist fuer die Probe nicht vorhanden.'
    $ast = [System.Management.Automation.Language.Parser]::ParseFile((Join-Path $installerDir 'install-friday.ps1'), [ref]$null, [ref]$null)
    $definition = $ast.Find({ param($node) $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq 'Set-NodeSessionPath' }, $true)
    Assert-True ([bool]$definition) 'Set-NodeSessionPath fehlt im Installer.'
    Invoke-Expression $definition.Extent.Text
    $savedPath = $env:Path
    try {
        $env:Path = '"' + (Split-Path $nodeExe) + '";' + (Join-Path $env:SystemRoot 'System32')
        $hidden = & cmd.exe /c 'where node.exe 2>nul'
        Assert-True (-not $hidden) 'Die Probe bildet den Fehler nicht ab: ein zitierter PATH-Eintrag verdeckte node.exe nicht.'
        Set-NodeSessionPath $nodeExe
        $found = & cmd.exe /c 'where node.exe 2>nul'
        Assert-True ([bool]$found) 'Nach der Korrektur findet der Kindprozess node.exe nicht.'
        Assert-True (($env:Path -split ';')[0] -eq (Split-Path $nodeExe)) 'Das Node-Verzeichnis steht nicht an erster Stelle.'
        Assert-True (-not ($env:Path -match '"')) 'Der PATH enthaelt weiterhin Anfuehrungszeichen.'
        Set-NodeSessionPath $nodeExe
        Assert-True (($env:Path -split ';' | Where-Object { $_ -eq (Split-Path $nodeExe) }).Count -eq 1) 'Ein zweiter Aufruf verdoppelt den Node-Eintrag.'
    } finally {
        $env:Path = $savedPath
    }

    # --- 6d) Zeitfenster: TTS 900 s, Modell 120 s, Dashboard 60 s, Download 3600 s bleiben getrennt
    Assert-True ($pathSource.Contains('Wait-Http "http://127.0.0.1:$ttsPort/health" 900')) 'Das TTS-Fenster von 900 s fehlt.'
    Assert-True ($pathSource.Contains('Wait-Http "http://127.0.0.1:$($Ports.Qwen)/v1/models" 120')) 'Das Modellfenster von 120 s fehlt.'
    Assert-True ($pathSource.Contains('Wait-Http "http://127.0.0.1:$($Ports.Dashboard)/" 60')) 'Das Dashboard-Fenster von 60 s fehlt.'
    Assert-True ($pathSource.Contains('$script:DownloadTimeoutSeconds = 3600')) 'Das Downloadfenster ist nicht getrennt definiert.'

    # --- 7) Verdrahtung im Installer: kein alter Code mehr, neue Grenzen vorhanden
    $installer = Get-Content -LiteralPath (Join-Path $installerDir 'install-friday.ps1') -Raw
    Assert-True ($installer.Contains("lib\wait-http.ps1") -and $installer.Contains("lib\wsl-keepalive.ps1") -and $installer.Contains("lib\download-integrity.ps1")) 'Der Installer laedt die neuen Module nicht.'
    Assert-True (-not ($installer -match "(?m)^\s*Native \{ wsl\.exe --update \}")) 'Der Installer ruft das WSL-Update noch ungebremst auf.'
    Assert-True ($installer.Contains("Invoke-CapturedProcess -FilePath 'wsl.exe' -Arguments @('--update') -TimeoutSeconds 600")) 'Das WSL-Update hat kein Zeitlimit von 600 s.'
    Assert-True ($installer.Contains('[switch]$SkipWslUpdate')) 'Das WSL-Update laesst sich nicht abschalten.'
    Assert-True (-not ($installer.Contains('("sha256:" + (Sha256 $zip)) -ne $a.digest'))) 'Die alte Archiv-Pruefsumme ohne Loeschung steht noch im Installer.'
    Assert-True (-not ($installer.Contains("(Sha256 `$model) -ne '7485fe6f"))) 'Die alte Modell-Pruefsumme ohne Loeschung steht noch im Installer.'
    Assert-True ($installer.Contains('Assert-FileSha256 $model')) 'Das Modell wird nicht ueber die Pruefsummenfunktion geprueft.'
    Assert-True (-not ($installer -match "Get-CimInstance Win32_Process -Filter `"Name='wsl\.exe'`"\s*\n\s*foreach")) 'Die Keepalive-Pruefung steht noch inline im Installer.'

    # --- 8) Gegenprobe: eine Kopie ohne Zeitlimit und ohne Loeschung wird als solche erkannt
    $bounded = "Invoke-CapturedProcess -FilePath 'wsl.exe' -Arguments @('--update') -TimeoutSeconds 600"
    $broken = $installer.Replace($bounded, 'Native { wsl.exe --update } | Out-Null')
    Assert-True ($broken.Contains('Native { wsl.exe --update }') -and -not $broken.Contains($bounded)) 'Die Gegenprobe ohne Zeitlimit blieb unentdeckt.'
    $brokenHash = $installer.Replace('if (-not (Assert-FileSha256 $model', 'if ($false -and (Assert-FileSha256 $model')
    Assert-True (-not $brokenHash.Contains('if (-not (Assert-FileSha256 $model')) 'Die Gegenprobe ohne Modellpruefung blieb unentdeckt.'

    # --- 9) I-010: Ein Abruf, der mitten im Download stehen bleibt, wird erkannt und neu versucht, statt bis zum
    # Downloadfenster zu haengen. Geprueft werden die echten curl-Argumente aus Download().
    Assert-True ($pathSource.Contains('$script:DownloadStallSeconds = 60')) 'Die Stillstandsgrenze fuer Downloads fehlt.'
    $argsMatch = [regex]::Match($pathSource, '(?s)function Download\(\$url, \$file\) \{.*?-Arguments (@\([^\r\n]*\)) `')
    Assert-True $argsMatch.Success 'Die curl-Argumente in Download() wurden nicht gefunden.'
    Assert-True ($argsMatch.Groups[1].Value.Contains('''--speed-time'', [string]$script:DownloadStallSeconds')) 'Download() bricht einen stehenden Abruf nicht ab.'
    $stallPort = 0
    foreach ($candidate in 18721..18729) {
        $probe = $null
        try {
            $probe = New-Object Net.Sockets.TcpListener([Net.IPAddress]::Loopback, $candidate)
            $probe.Start()
            $stallPort = $candidate
            break
        } catch {
        } finally {
            if ($probe) { $probe.Stop() }
        }
    }
    Assert-True ($stallPort -gt 0) 'Kein freier Port fuer den Stillstandsserver gefunden.'
    $servers += Start-Job -ArgumentList $stallPort -ScriptBlock {
        param($port)
        $data = New-Object byte[] 400000
        for ($i = 0; $i -lt $data.Length; $i++) { $data[$i] = [byte]($i % 251) }
        $listener = New-Object Net.HttpListener
        $listener.Prefixes.Add("http://127.0.0.1:$port/")
        $listener.Start()
        $seen = @{}
        $stalled = New-Object Collections.ArrayList
        while ($listener.IsListening) {
            try {
                $context = $listener.GetContext()
                $start = 0
                if ("$($context.Request.Headers['Range'])" -match '^bytes=(\d+)-') { $start = [int]$Matches[1] }
                if ($start -gt 0) {
                    $context.Response.StatusCode = 206
                    $context.Response.AddHeader('Content-Range', "bytes $start-$($data.Length - 1)/$($data.Length)")
                }
                $context.Response.ContentLength64 = $data.Length - $start
                $path = $context.Request.Url.AbsolutePath
                if (-not $seen.ContainsKey($path)) {
                    # Erster Abruf je Pfad: ein Viertel liefern, dann bei offener Verbindung stehen bleiben.
                    $seen[$path] = $true
                    $context.Response.OutputStream.Write($data, $start, 100000)
                    $context.Response.OutputStream.Flush()
                    [void]$stalled.Add($context)
                    continue
                }
                $context.Response.OutputStream.Write($data, $start, $data.Length - $start)
                $context.Response.OutputStream.Close()
            } catch { break }
        }
    }
    Assert-True (Wait-Until { try { $c = New-Object Net.Sockets.TcpClient('127.0.0.1', $stallPort); $c.Close(); $true } catch { $false } } 10000) 'Der Stillstandsserver startete nicht.'
    $script:DownloadStallSeconds = 3
    $file = Join-Path $dir 'stall.gguf'
    $url = "http://127.0.0.1:$stallPort/stall.gguf"
    $curlArgs = @(& ([scriptblock]::Create($argsMatch.Groups[1].Value)))
    $proc = Start-Process -FilePath 'curl.exe' -ArgumentList ($curlArgs | ForEach-Object { '"' + $_ + '"' }) -PassThru -NoNewWindow
    $null = $proc.Handle
    $exited = $proc.WaitForExit(60000)
    if (-not $exited) { Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue }
    Assert-True $exited 'curl blieb bei einem stehenden Abruf haengen.'
    Assert-True ($proc.ExitCode -eq 0) "curl endete nach dem Stillstand mit Exitcode $($proc.ExitCode)."
    $got = [IO.File]::ReadAllBytes($file)
    Assert-True ($got.Length -eq 400000) "Nach dem Stillstand fehlen Daten: $($got.Length) von 400000 Bytes."
    $wrong = @(0, 99999, 100000, 250000, 399999 | Where-Object { $got[$_] -ne [byte]($_ % 251) })
    Assert-True ($wrong.Count -eq 0) "Die nach dem Stillstand geholte Datei ist verfaelscht (Offsets $($wrong -join ', '))."
    # Gegenprobe: dieselben Argumente ohne Stillstandsgrenze bleiben am stehenden Abruf haengen.
    $noStall = @()
    for ($i = 0; $i -lt $curlArgs.Count; $i++) {
        if (@('--speed-limit', '--speed-time') -contains $curlArgs[$i]) { $i++; continue }
        $noStall += $curlArgs[$i]
    }
    $file = Join-Path $dir 'gegenprobe.gguf'
    $url = "http://127.0.0.1:$stallPort/gegenprobe.gguf"
    $noStall = @($noStall | ForEach-Object { if ($_ -like '*stall.gguf') { $_.Replace('stall.gguf', 'gegenprobe.gguf') } else { $_ } })
    $proc = Start-Process -FilePath 'curl.exe' -ArgumentList ($noStall | ForEach-Object { '"' + $_ + '"' }) -PassThru -NoNewWindow
    $hung = -not $proc.WaitForExit(8000)
    Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue
    Assert-True $hung 'Die Gegenprobe ohne Stillstandsgrenze endete, der Test erkennt einen haengenden Abruf nicht.'
} finally {
    foreach ($job in $servers) { Stop-Job -Job $job -ErrorAction SilentlyContinue; Remove-Job -Job $job -Force -ErrorAction SilentlyContinue }
    if ($dir -and (Test-Path -LiteralPath $dir)) {
        $verified = [IO.Path]::GetFullPath($dir)
        if ($verified.StartsWith(([IO.Path]::GetFullPath($env:TEMP).TrimEnd('\') + '\'), [StringComparison]::OrdinalIgnoreCase)) {
            Remove-Item -LiteralPath $verified -Recurse -Force -ErrorAction SilentlyContinue
        }
    }
}

Write-Host "Installerregressionen: PASS ($script:checks Zusicherungen, 503 als Laden, Keepalive als Prozess, Pruefsummen mit Loeschung, WSL-Update begrenzt, Download-Stillstand erkannt)"
