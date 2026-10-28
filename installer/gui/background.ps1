# Hintergrund des Assistenten: das Originalbild einmal seitenverhaeltnistreu ueber die ganze
# Clientflaeche, darueber der rechte Bereich als nahezu deckende Flaeche. Fehlt das Bild, entsteht eine
# dokumentierte Ersatzflaeche - die Oberflaeche stuerzt nicht ab und meldet den Zustand.

function Resolve-GuiBackdrop([string]$Path, [string[]]$AdditionalPaths = @()) {
    # Reihenfolge: mitgeliefertes Asset, dann die Root-Datei des Nutzers. Geprueft wird hier nur die
    # Lesbarkeit; die Bildidentitaet sichert der Abnahmetest ueber den Hash.
    $candidates = @($Path) + @($AdditionalPaths)
    foreach ($candidate in $candidates) {
        if (-not $candidate) { continue }
        if (-not (Test-Path -LiteralPath $candidate -PathType Leaf)) { continue }
        try {
            $image = [System.Drawing.Image]::FromFile($candidate)
            return [ordered]@{ Image = $image; Path = $candidate; Fallback = $false; Notice = '' }
        } catch {
            return [ordered]@{ Image = $null; Path = $candidate; Fallback = $true; Notice = 'Das Installerbild ist nicht lesbar; es wird eine Ersatzflaeche verwendet.' }
        }
    }
    return [ordered]@{ Image = $null; Path = ''; Fallback = $true; Notice = 'Das Installerbild fehlt; es wird eine Ersatzflaeche verwendet.' }
}

function New-GuiBackdropBitmap($Backdrop, [System.Drawing.Size]$Client, [int]$SplitX) {
    # Ergebnis ist genau eine Clientflaeche gross: das Cover wird mittig beschnitten, sodass beim
    # Zeichnen nichts gestreckt wird. Der rechte Bereich liegt zu 94 % deckend darueber.
    if ($Client.Width -le 0 -or $Client.Height -le 0) { return $null }
    $bitmap = New-Object System.Drawing.Bitmap($Client.Width, $Client.Height)
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
    try {
        $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
        $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
        if ($Backdrop -and $Backdrop.Image) {
            # Quelle ist der mittige Ausschnitt des Originals: gleiche Deckung wie ein Cover, aber ohne
            # negative Quellkoordinaten und damit ohne GDI+-Randefehler.
            $crop = Get-GuiCropSource (New-Object System.Drawing.Size($Backdrop.Image.Width, $Backdrop.Image.Height)) $Client
            $graphics.DrawImage($Backdrop.Image, (New-Object System.Drawing.Rectangle(0, 0, $Client.Width, $Client.Height)), $crop.X, $crop.Y, $crop.Width, $crop.Height, [System.Drawing.GraphicsUnit]::Pixel)
        } else {
            $fallback = New-Object System.Drawing.SolidBrush((Get-GuiColor $script:GuiLayout.FallbackSurface))
            try { $graphics.FillRectangle($fallback, 0, 0, $Client.Width, $Client.Height) } finally { $fallback.Dispose() }
        }
        $surface = Get-GuiColor $script:GuiLayout.Surface
        $overlay = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb($script:GuiLayout.OverlayAlpha, $surface.R, $surface.G, $surface.B))
        try { $graphics.FillRectangle($overlay, (New-Object System.Drawing.Rectangle($SplitX, 0, [math]::Max(0, $Client.Width - $SplitX), $Client.Height))) } finally { $overlay.Dispose() }
        $pen = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(60, 148, 163, 184), 1)
        try { $graphics.DrawLine($pen, $SplitX, 0, $SplitX, $Client.Height) } finally { $pen.Dispose() }
    } finally { $graphics.Dispose() }
    return $bitmap
}