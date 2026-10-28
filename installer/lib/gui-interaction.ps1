# Interaktionsdateien der Stimmaufnahme: der Assistent liest die Anfrage und schreibt genau eine Antwort.
# Dieselbe Datei spricht die Aufnahme (installer/voice/gui_interaction.py) - deshalb ein gemeinsamer Vertrag.
$script:GuiInteractionAllowedActions = @('ok', 'replay', 'skip', 'cancel')

function Get-GuiInteractionPaths([string]$Root) {
    $runDir = Join-Path $Root 'run'
    $request = Join-Path $runDir 'gui-interaction.json'
    return [ordered]@{
        Directory = $runDir
        Request   = $request
        Response  = ($request + '.response')
        Temporary = ($request + '.tmp')
    }
}

function Read-GuiInteractionRequest([string]$Root) {
    # Liefert die offene Anfrage oder $null. Eine halb geschriebene oder fremde Datei gilt als keine Anfrage.
    if (-not $Root) { return $null }
    $paths = Get-GuiInteractionPaths $Root
    if (-not (Test-Path -LiteralPath $paths.Request -PathType Leaf)) { return $null }
    try {
        $request = Get-Content -LiteralPath $paths.Request -Raw -Encoding UTF8 | ConvertFrom-Json
    } catch { return $null }
    if (-not $request -or -not $request.id) { return $null }
    if ([string]$request.v -ne '1') { return $null }
    $kind = [string]$request.kind
    if ($kind -notin @('record', 'confirm', 'text')) { return $null }
    if (-not ([string]$request.prompt)) { return $null }
    $actions = @($request.actions | ForEach-Object { [string]$_ } | Where-Object { $script:GuiInteractionAllowedActions -contains $_ })
    if ($actions.Count -eq 0) { $actions = @('ok', 'cancel') }
    return [ordered]@{
        Id      = [string]$request.id
        Kind    = $kind
        Title   = [string]$request.title
        Prompt  = [string]$request.prompt
        Detail  = [string]$request.detail
        Block   = [string]$request.block
        Index   = [int]$request.index
        Total   = [int]$request.total
        Actions = $actions
        Created = [string]$request.created
    }
}

function Write-GuiInteractionFile([string]$Path, [hashtable]$Payload) {
    # Erst die Zwischendatei, dann ersetzen: die Gegenseite sieht nie halben Inhalt.
    $json = ($Payload | ConvertTo-Json -Depth 4 -Compress)
    $temporary = $Path + '.tmp'
    [IO.File]::WriteAllText($temporary, $json, (New-Object Text.UTF8Encoding $false))
    if (Test-Path -LiteralPath $Path -PathType Leaf) {
        try { [IO.File]::Replace($temporary, $Path, $null) } catch { Move-Item -LiteralPath $temporary -Destination $Path -Force }
    } else {
        Move-Item -LiteralPath $temporary -Destination $Path -Force
    }
}

function Send-GuiInteractionResponse([string]$Root, [string]$Id, [string]$Action) {
    # Antwortet genau auf die offene Anfrage. Ohne passende Kennung wird nichts geschrieben.
    if (-not $Root -or -not $Id) { return $false }
    if ($script:GuiInteractionAllowedActions -notcontains $Action) { return $false }
    $request = Read-GuiInteractionRequest $Root
    if (-not $request -or $request.Id -ne $Id) { return $false }
    if ($request.Actions -notcontains $Action) { return $false }
    $paths = Get-GuiInteractionPaths $Root
    try {
        Write-GuiInteractionFile $paths.Response @{
            v = 1; id = $Id; action = $Action
            at = (Get-Date).ToString('s')
        }
        return $true
    } catch { return $false }
}

function Clear-GuiInteraction([string]$Root) {
    # Vor und nach jedem Aufnahmeversuch aufraeumen, damit keine alte Anfrage einen Lauf blockiert.
    if (-not $Root) { return }
    $paths = Get-GuiInteractionPaths $Root
    foreach ($path in @($paths.Request, $paths.Response, $paths.Temporary)) {
        if (Test-Path -LiteralPath $path) { Remove-Item -LiteralPath $path -Force -ErrorAction SilentlyContinue }
    }
}
