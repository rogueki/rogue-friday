# HTTP-Bereitschaft eines lokalen Dienstes: erreichbar, laedt noch oder gar nicht da.
# Hintergrund (Regression 2026-10-21): Der TTS-Server antwortet waehrend des Modellstarts mit HTTP 503
# ("Loading model"). Ein reiner Fehlversuch sah wie ein Abbruch aus; "laeuft und laedt" muss von
# "nicht erreichbar" unterscheidbar sein, damit Modellstart und Dienstbereitschaft getrennt diagnostizierbar sind.

function Invoke-HttpProbe([string]$Url, [hashtable]$Headers = @{}, [int]$TimeoutMilliseconds = 3000) {
    # Klassifikation: ready (2xx), loading (503), error (andere HTTP-Antwort), unreachable (keine Verbindung).
    $request = $null
    $response = $null
    try {
        $request = [Net.WebRequest]::Create($Url)
        $request.Method = 'GET'
        $request.Timeout = $TimeoutMilliseconds
        $request.Proxy = $null
        foreach ($name in $Headers.Keys) { $request.Headers[$name] = $Headers[$name] }
        $response = $request.GetResponse()
        $status = [int]$response.StatusCode
        return [ordered]@{
            Classification = if ($status -ge 200 -and $status -lt 300) { 'ready' } else { 'error' }
            StatusCode     = $status
            Message        = "HTTP $status"
        }
    } catch [Net.WebException] {
        $failed = $_.Exception
        if ($failed.Response) {
            $status = [int]$failed.Response.StatusCode
            $failed.Response.Close()
            return [ordered]@{
                Classification = if ($status -eq 503) { 'loading' } else { 'error' }
                StatusCode     = $status
                Message        = "HTTP $status"
            }
        }
        return [ordered]@{ Classification = 'unreachable'; StatusCode = 0; Message = $failed.Message }
    } catch {
        return [ordered]@{ Classification = 'unreachable'; StatusCode = 0; Message = $_.Exception.Message }
    } finally {
        if ($response) { $response.Close() }
    }
}

function Wait-HttpEndpoint([string]$Url, [int]$Seconds, [hashtable]$Headers = @{}, [int]$PollSeconds = 3, [scriptblock]$CancelCheck) {
    # Fragt bis zum Erfolg oder bis zum Ablauf. 503 zaehlt als "laedt", nicht als Fehler.
    $started = Get-Date
    $until = $started.AddSeconds([math]::Max(1, $Seconds))
    $attempts = 0
    $loading = 0
    $last = $null
    while ((Get-Date) -lt $until) {
        if ($CancelCheck) { & $CancelCheck }
        $attempts++
        $last = Invoke-HttpProbe -Url $Url -Headers $Headers
        if ($last.Classification -eq 'ready') {
            return [ordered]@{
                Ok = $true; Attempts = $attempts; Loading = $loading; Classification = 'ready'
                StatusCode = $last.StatusCode; Seconds = [math]::Round(((Get-Date) - $started).TotalSeconds, 1)
            }
        }
        if ($last.Classification -eq 'loading') { $loading++ }
        Start-Sleep -Seconds $PollSeconds
    }
    return [ordered]@{
        Ok = $false; Attempts = $attempts; Loading = $loading
        Classification = if ($last) { $last.Classification } else { 'unreachable' }
        StatusCode = if ($last) { $last.StatusCode } else { 0 }
        Seconds = [math]::Round(((Get-Date) - $started).TotalSeconds, 1)
    }
}
