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

# Reihenfolge der Installationsschritte. Sie ist die einzige Quelle fuer den einen Fortschrittsbalken
# und wird im Test gegen die Schrittfolge des Installers geprueft, damit beide nicht auseinanderlaufen.
$script:GuiStepOrder = @(
    'preflight', 'files', 'wslfeature', 'power', 'persona', 'wslconfig', 'distro', 'linuxuser',
    'keepalive', 'hermes', 'qwen', 'voicepython', 'enroll', 'voiceservice', 'dashboard'
)

function Get-GuiStepPercent([string]$Step) {
    # Unbekannte Schritte lassen den Balken stehen, statt einen falschen Fortschritt zu behaupten.
    $index = [array]::IndexOf($script:GuiStepOrder, $Step)
    if ($index -lt 0) { return -1 }
    return [int][math]::Round((($index + 1) / $script:GuiStepOrder.Count) * 100)
}
function Get-GuiColor([string]$Hex) {
    return [System.Drawing.ColorTranslator]::FromHtml($Hex)
}

function New-GuiFont([double]$Size, [System.Drawing.FontStyle]$Style = [System.Drawing.FontStyle]::Regular, [double]$Scale = 1.0) {
    if ($Scale -le 0) { $Scale = 1.0 }
    return New-Object System.Drawing.Font($script:GuiLayout.FontFamily, ($Size * $Scale), $Style, [System.Drawing.GraphicsUnit]::Point)
}

function Get-GuiLayout([System.Drawing.Size]$Client, [double]$Scale = 1.0) {
    # Rechnet den Vertrag auf die tatsaechliche Clientflaeche um: rechter Bereich, Inhalt, Footer.
    # $Scale ist die Anzeigeskalierung (1.0 = 100 %, 1.5 = 150 %): alle Abstaende wachsen mit, damit
    # bei hoeherer DPI weder Text am Rand klebt noch Schaltflaechen aus der Fusszeile laufen.
    if ($Scale -le 0) { $Scale = 1.0 }
    $padding = [int][math]::Round($script:GuiLayout.ContentPadding * $Scale)
    $footerHeight = [int][math]::Round($script:GuiLayout.FooterHeight * $Scale)
    $top = [int][math]::Round($script:GuiLayout.ContentTop * $Scale)
    $splitTarget = [int][math]::Round($script:GuiLayout.SplitX * $Scale)
    $splitMin = [int][math]::Round(320 * $Scale)
    $splitX = [int][math]::Min($splitTarget, [math]::Max($splitMin, [int]($Client.Width * 0.45)))
    $footerY = $Client.Height - $footerHeight
    $contentX = $splitX + $padding
    $contentWidth = $Client.Width - $contentX - $padding
    $contentHeight = $footerY - $top - $padding
    return [ordered]@{
        Scale         = $Scale
        SplitX        = $splitX
        Padding       = $padding
        FooterHeight  = $footerHeight
        ContentTop    = $top
        Footer        = (New-Object System.Drawing.Rectangle(0, $footerY, $Client.Width, $footerHeight))
        Content       = (New-Object System.Drawing.Rectangle($contentX, $top, [math]::Max(0, $contentWidth), [math]::Max(0, $contentHeight)))
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