# Layoutvertrag des Assistenten (Masterplan Abschnitt 3): Masse in logischen Pixeln bei 100 %.
# Alle Werte stehen hier einmal; die Oberflaeche liest sie, statt Zahlen zu wiederholen.
$script:GuiLayout = [ordered]@{
    WindowWidth        = 1200
    WindowHeight       = 760
    MinimumWidth       = 1024
    MinimumHeight      = 680
    SplitX             = 624     # Bildbereich x=0..623, rechter Bereich ab 624
    ContentPadding     = 32
    ContentTop         = 36
    FooterHeight       = 80
    ButtonHeight       = 40
    ButtonGap          = 12
    ProgressHeight     = 16
    OverlayAlpha       = 240     # 94 % von 255
    Surface            = '#111827'
    FallbackSurface    = '#0B1220'
    PrimaryText        = '#F9FAFB'
    SecondaryText      = '#D1D5DB'
    Accent             = '#60A5FA'
    FontFamily         = 'Segoe UI'
    TitleSize          = 24
    SectionSize        = 14
    BodySize           = 11
    HelpSize           = 10
    DetailsHint        = 'Details'
}

function Get-GuiColor([string]$Hex) {
    return [System.Drawing.ColorTranslator]::FromHtml($Hex)
}

function New-GuiFont([double]$Size, [System.Drawing.FontStyle]$Style = [System.Drawing.FontStyle]::Regular) {
    return New-Object System.Drawing.Font($script:GuiLayout.FontFamily, $Size, $Style, [System.Drawing.GraphicsUnit]::Point)
}

function Get-GuiLayout([System.Drawing.Size]$Client) {
    # Rechnet den Vertrag auf die tatsaechliche Clientflaeche um: rechter Bereich, Inhalt, Footer.
    # Der Footer bleibt immer erreichbar; bei schmaler Flaeche waechst der rechte Bereich nicht unter
    # das Minimum, sondern die Bildspalte schrumpft zuerst.
    $splitX = [int][math]::Min($script:GuiLayout.SplitX, [math]::Max(320, [int]($Client.Width * 0.45)))
    $footerY = $Client.Height - $script:GuiLayout.FooterHeight
    $contentX = $splitX + $script:GuiLayout.ContentPadding
    $contentWidth = $Client.Width - $contentX - $script:GuiLayout.ContentPadding
    $contentY = $script:GuiLayout.ContentTop
    $contentHeight = $footerY - $contentY - $script:GuiLayout.ContentPadding
    return [ordered]@{
        SplitX        = $splitX
        Footer        = (New-Object System.Drawing.Rectangle(0, $footerY, $Client.Width, $script:GuiLayout.FooterHeight))
        Content       = (New-Object System.Drawing.Rectangle($contentX, $contentY, [math]::Max(0, $contentWidth), [math]::Max(0, $contentHeight)))
        Backdrop      = (New-Object System.Drawing.Rectangle(0, 0, $Client.Width, $Client.Height))
    }
}

function Get-GuiCoverRectangle([System.Drawing.Size]$Image, [System.Drawing.Size]$Client) {
    # Seitenverhaeltnistreues Cover: das Bild deckt die Clientflaeche vollstaendig, wird nicht gestreckt
    # und nur am aeusseren Rahmen beschnitten. Das Rechteck darf ueber die Clientflaeche hinausragen.
    if ($Image.Width -le 0 -or $Image.Height -le 0 -or $Client.Width -le 0 -or $Client.Height -le 0) {
        return New-Object System.Drawing.Rectangle(0, 0, [math]::Max(0, $Client.Width), [math]::Max(0, $Client.Height))
    }
    $scale = [math]::Max($Client.Width / $Image.Width, $Client.Height / $Image.Height)
    $width = [int][math]::Round($Image.Width * $scale)
    $height = [int][math]::Round($Image.Height * $scale)
    $x = [int][math]::Round(($Client.Width - $width) / 2)
    $y = [int][math]::Round(($Client.Height - $height) / 2)
    return New-Object System.Drawing.Rectangle($x, $y, $width, $height)
}

function Get-GuiCropSource([System.Drawing.Size]$Image, [System.Drawing.Size]$Client) {
    # Gegenstueck zu Get-GuiCoverRectangle in Bildkoordinaten: der mittige Ausschnitt, der die
    # Clientflaeche genau fuellt. So zeichnet der Rahmen ohne negative Quellkoordinaten und ohne
    # Verzerrung; beschnitten wird nur am aeusseren Rand.
    if ($Image.Width -le 0 -or $Image.Height -le 0 -or $Client.Width -le 0 -or $Client.Height -le 0) {
        return New-Object System.Drawing.RectangleF(0, 0, [math]::Max(1, $Image.Width), [math]::Max(1, $Image.Height))
    }
    $scale = [math]::Max($Client.Width / $Image.Width, $Client.Height / $Image.Height)
    $sourceWidth = [single]($Client.Width / $scale)
    $sourceHeight = [single]($Client.Height / $scale)
    $sourceX = [single](($Image.Width - $sourceWidth) / 2)
    $sourceY = [single](($Image.Height - $sourceHeight) / 2)
    return New-Object System.Drawing.RectangleF($sourceX, $sourceY, $sourceWidth, $sourceHeight)
}
function Get-GuiRelativeLuminance([System.Drawing.Color]$Color) {
    # WCAG 2.1: Kanal auf 0..1 normieren, linearisieren, dann 0.2126/0.7152/0.0722 gewichten.
    $channels = @($Color.R, $Color.G, $Color.B)
    $linear = foreach ($channel in $channels) {
        $value = $channel / 255.0
        if ($value -le 0.03928) { $value / 12.92 } else { [math]::Pow((($value + 0.055) / 1.055), 2.4) }
    }
    return 0.2126 * $linear[0] + 0.7152 * $linear[1] + 0.0722 * $linear[2]
}

function Get-GuiContrastRatio([System.Drawing.Color]$Foreground, [System.Drawing.Color]$Background) {
    $lighter = Get-GuiRelativeLuminance $Foreground
    $darker = Get-GuiRelativeLuminance $Background
    if ($lighter -lt $darker) { $swap = $lighter; $lighter = $darker; $darker = $swap }
    return ($lighter + 0.05) / ($darker + 0.05)
}

function Get-GuiBackdropColor([System.Drawing.Color]$ImagePixel) {
    # Der rechte Bereich liegt mit 94 % Deckkraft ueber dem Bild: die messbare Textfarbe ist diese Mischung.
    $surface = Get-GuiColor $script:GuiLayout.Surface
    $alpha = $script:GuiLayout.OverlayAlpha / 255.0
    $blend = { param($over, $under) [int][math]::Round($over * $alpha + $under * (1 - $alpha)) }
    return [System.Drawing.Color]::FromArgb(255, (& $blend $surface.R $ImagePixel.R), (& $blend $surface.G $ImagePixel.G), (& $blend $surface.B $ImagePixel.B))
}