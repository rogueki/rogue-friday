# Ereignisstrom zwischen Installer und GUI (Protokoll 2).
# Jedes Ereignis ist eine einzige Zeile mit Praefix, damit die bestehende zeilenweise Uebertragung
# unveraendert bleibt und eine alte GUI die Zeilen einfach als Text anzeigen kann.
$script:GuiEventPrefix = '[FRIDAY-EVENT]'
$script:GuiProtocolVersion = 2

function ConvertTo-GuiEventLine([hashtable]$Event) {
    $payload = [ordered]@{ v = $script:GuiProtocolVersion; type = [string]$Event['type'] }
    foreach ($key in $Event.Keys) {
        if ($key -eq 'type' -or $key -eq 'v') { continue }
        $payload[$key] = $Event[$key]
    }
    $json = ConvertTo-Json -InputObject $payload -Compress -Depth 4
    # ConvertTo-Json maskiert Zeilenumbrueche bereits; der Ersatz ist das Sicherheitsnetz dagegen, dass
    # ein mehrzeiliger Wert die Zeilenuebertragung zerreisst.
    return $script:GuiEventPrefix + ($json -replace "[`r`n]", ' ')
}

function ConvertFrom-GuiEventLine([string]$Line) {
    # Rueckgabe: Kind 'event' mit Event-Objekt, sonst 'text' mit der unveraenderten Zeile. Alles, was
    # nicht eindeutig als Ereignis dieser Version erkennbar ist, bleibt sichtbarer Text - nie still verschluckt.
    $result = @{ Kind = 'text'; Event = $null; Text = $Line }
    if (-not $Line) { return $result }
    $trimmed = $Line.TrimStart()
    if (-not $trimmed.StartsWith($script:GuiEventPrefix, [StringComparison]::Ordinal)) { return $result }
    $json = $trimmed.Substring($script:GuiEventPrefix.Length)
    if (-not $json -or -not $json.Trim()) { return $result }
    try { $parsed = $json | ConvertFrom-Json } catch { return $result }
    if (-not $parsed -or $parsed -isnot [System.Management.Automation.PSCustomObject]) { return $result }
    if (-not $parsed.PSObject.Properties['v'] -or -not $parsed.PSObject.Properties['type']) { return $result }
    $version = 0
    if (-not [int]::TryParse([string]$parsed.v, [ref]$version)) { return $result }
    if ($version -ne $script:GuiProtocolVersion) { return $result }
    $result.Kind = 'event'
    $result.Event = $parsed
    return $result
}

function Write-GuiEvent([string]$Type, [hashtable]$Data = @{}) {
    # Nur im GUI-Lauf: die Konsole eines Doppelklicks soll keine Protokollzeilen zeigen.
    if (-not $env:FRIDAY_INSTALL_RUN) { return }
    $payload = @{ type = $Type }
    foreach ($key in $Data.Keys) { $payload[$key] = $Data[$key] }
    Write-Host (ConvertTo-GuiEventLine $payload)
}
$script:GuiRunDoneWritten = $false
function Write-GuiRunDone([int]$Code, [string]$State) {
    # Genau ein Abschlussereignis je Lauf: mehrere Abbruchpfade duerfen es nicht doppelt schreiben.
    if ($script:GuiRunDoneWritten) { return }
    $script:GuiRunDoneWritten = $true
    Write-GuiEvent 'run' @{ state = $State; exitCode = $Code }
}