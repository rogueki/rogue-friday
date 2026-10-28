# Rechte Assistentenoberflaeche: Originalbild, Aufteilung, Kontrast und Tastaturbedienung.
# Geprueft wird am echt gezeichneten Fenster (DrawToBitmap der Clientflaeche), nicht an Konstanten.
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

if ([System.Threading.Thread]::CurrentThread.GetApartmentState() -ne 'STA') {
    # WinForms braucht STA; der Test startet sich sonst selbst neu und gibt den Exitcode weiter.
    $arguments = '-NoProfile -STA -ExecutionPolicy Bypass -File "' + $PSCommandPath + '"'
    $process = Start-Process -FilePath powershell.exe -ArgumentList $arguments -Wait -PassThru -NoNewWindow
    exit $process.ExitCode
}

$ErrorActionPreference = 'Stop'
$gui = Join-Path $PSScriptRoot '..\gui'
. (Join-Path $gui 'layout.ps1')
. (Join-Path $gui 'background.ps1')
. (Join-Path $gui 'shell.ps1')

$script:checks = 0
function Assert-True([bool]$Condition, [string]$Message) {
    $script:checks++
    if (-not $Condition) { throw $Message }
}

$asset = Join-Path $PSScriptRoot '..\assets\installer_background.png'
$rootOriginal = Join-Path $PSScriptRoot '..\..\installer_background.png'

# --- 1. Bild per Hash auf das Root-Original zurueckgefuehrt
Assert-True (Test-Path -LiteralPath $asset -PathType Leaf) 'Das Installerbild fehlt in installer/assets.'
$hash = (Get-FileHash -LiteralPath $asset -Algorithm SHA256).Hash
Assert-True ($hash -eq '43D46072C2CC21EBBF534BFE6C2C0DDA3C39092845CDCE0EDC8AC8D62C464B72') "Bildhash weicht vom Masterplan ab: $hash"
if (Test-Path -LiteralPath $rootOriginal -PathType Leaf) {
    $rootHash = (Get-FileHash -LiteralPath $rootOriginal -Algorithm SHA256).Hash
    Assert-True ($hash -eq $rootHash) 'Das mitgelieferte Bild ist nicht bytegleich zum Root-Original.'
    Assert-True ((Get-Item -LiteralPath $asset).Length -eq (Get-Item -LiteralPath $rootOriginal).Length) 'Bildgroesse weicht vom Root-Original ab.'
}

# --- 2. Cover-Rechnung: seitenverhaeltnistreu, vollstaendig deckend, mittig
$imageSize = New-Object System.Drawing.Size(1672, 941)
foreach ($client in @((New-Object System.Drawing.Size(1200, 760)), (New-Object System.Drawing.Size(1024, 680)))) {
    $cover = Get-GuiCoverRectangle $imageSize $client
    Assert-True ($cover.X -le 0 -and $cover.Y -le 0) "Cover beginnt innerhalb der Flaeche ($($cover.X),$($cover.Y))."
    Assert-True (($cover.X + $cover.Width) -ge $client.Width) 'Cover deckt die Breite nicht.'
    Assert-True (($cover.Y + $cover.Height) -ge $client.Height) 'Cover deckt die Hoehe nicht.'
    $imageRatio = $imageSize.Width / $imageSize.Height
    $coverRatio = $cover.Width / $cover.Height
    Assert-True ([math]::Abs($imageRatio - $coverRatio) -lt 0.01) "Cover verzerrt das Bild ($coverRatio statt $imageRatio)."
    Assert-True ([math]::Abs($cover.X - ($client.Width - $cover.Width) / 2) -le 1) 'Cover ist nicht mittig.'
    $crop = Get-GuiCropSource $imageSize $client
    Assert-True ($crop.X -ge 0 -and $crop.Y -ge 0) 'Der Bildausschnitt beginnt ausserhalb des Originals.'
    Assert-True (($crop.X + $crop.Width) -le $imageSize.Width + 1 -and ($crop.Y + $crop.Height) -le $imageSize.Height + 1) 'Der Bildausschnitt reicht ueber das Original hinaus.'
    # Der Ausschnitt wird auf die Clientflaeche gezeichnet: beide Achsen muessen denselben Faktor haben,
    # sonst waere das Bild gestreckt.
    $scaleX = $client.Width / $crop.Width
    $scaleY = $client.Height / $crop.Height
    Assert-True ([math]::Abs($scaleX - $scaleY) -lt 0.01) "Ausschnitt wird ungleichmaessig skaliert ($scaleX statt $scaleY)."
    Assert-True ([math]::Abs(($crop.Width / $crop.Height) - ($client.Width / $client.Height)) -lt 0.01) 'Ausschnitt passt nicht zum Seitenverhaeltnis der Zielflaeche.'
}

# --- 3. Kontrast an echt gezeichneten Pixeln
function Get-RegionAverage([System.Drawing.Bitmap]$Bitmap, [System.Drawing.Rectangle]$Region) {
    $sumR = 0; $sumG = 0; $sumB = 0; $count = 0
    for ($y = $Region.Top; $y -lt $Region.Bottom; $y += 4) {
        for ($x = $Region.Left; $x -lt $Region.Right; $x += 4) {
            $pixel = $Bitmap.GetPixel($x, $y)
            $sumR += $pixel.R; $sumG += $pixel.G; $sumB += $pixel.B; $count++
        }
    }
    if ($count -eq 0) { return [System.Drawing.Color]::Black }
    return [System.Drawing.Color]::FromArgb(255, [int]($sumR / $count), [int]($sumG / $count), [int]($sumB / $count))
}

function Test-Shell([System.Drawing.Size]$Client, [string]$Scenario) {
    $shell = New-GuiShell -ClientSize $Client
    Assert-True ($null -ne $shell.BackdropBitmap) "$Scenario - Hintergrund wurde nicht zusammengesetzt."
    # Text liegt zu 94 % auf der Flaeche; die Beschriftungen sind durchsichtig, damit das Motiv
    # durchscheint. Geprueft wird deshalb genau der Pixel, auf dem die Schrift sitzt.
    $shell.Content.BackColor = [System.Drawing.Color]::Transparent
    foreach ($label in @($shell.StepLabel, $shell.TitleLabel, $shell.BodyLabel)) { $label.BackColor = [System.Drawing.Color]::Transparent }
    $shell.Footer.BackColor = [System.Drawing.Color]::Transparent
    Set-GuiShellPage $shell 'Schritt 1 von 3' 'Willkommen bei F.R.I.D.A.Y.' 'Der Assistent fuehrt durch die Einrichtung; nichts davon braucht ein Terminal.' $true 40

    $form = $shell.Form
    $form.Show()
    [System.Windows.Forms.Application]::DoEvents()
    Start-Sleep -Milliseconds 250
    [System.Windows.Forms.Application]::DoEvents()
    $bitmap = New-Object System.Drawing.Bitmap($shell.Panel.Width, $shell.Panel.Height)
    try {
        $shell.Panel.DrawToBitmap($bitmap, (New-Object System.Drawing.Rectangle(0, 0, $bitmap.Width, $bitmap.Height)))
        $bitmap.Save((Join-Path $env:TEMP ("friday-shell-$($Client.Width)x$($Client.Height).png")))

        $split = $shell.Layout.SplitX
        $content = $shell.Layout.Content

        # 3a. Links bleibt das Bild sichtbar: viele verschiedene Farben, deutlich vom Motivbereich
        # der Arbeitsflaeche verschieden.
        $leftColors = @{}
        for ($y = 4; $y -lt $Client.Height - 4; $y += 24) {
            for ($x = 4; $x -lt $split - 4; $x += 24) { $leftColors[$bitmap.GetPixel($x, $y).ToArgb()] = $true }
        }
        Assert-True ($leftColors.Count -ge 20) "$Scenario - links ist kein Bild sichtbar ($($leftColors.Count) Farben)."

        # 3b. Rechts ist die Flaeche so dunkel, dass Text unabhaengig vom Motiv lesbar bleibt. Gemessen
        # wird am Hintergrundmaterial (Bild plus 94 % Flaeche), nicht am gerenderten Text selbst.
        $rightAverage = Get-RegionAverage $shell.BackdropBitmap $content
        $primary = Get-GuiColor $script:GuiLayout.PrimaryText
        $secondary = Get-GuiColor $script:GuiLayout.SecondaryText
        Assert-True ((Get-GuiContrastRatio $primary $rightAverage) -ge 4.5) ("$Scenario - Kontrast Titel/Flaeche zu gering: {0:N1}:1" -f (Get-GuiContrastRatio $primary $rightAverage))
        Assert-True ((Get-GuiContrastRatio $secondary $rightAverage) -ge 4.5) ("$Scenario - Kontrast Text/Flaeche zu gering: {0:N1}:1" -f (Get-GuiContrastRatio $secondary $rightAverage))
        # Grosse Schrift braucht mindestens 3:1; hier ist mehr als das Doppelte gefordert, weil die
        # Flaeche durch das Motiv um bis zu 6 % aufgehellt wird.
        Assert-True ((Get-GuiContrastRatio $primary $rightAverage) -ge 7.0) ("$Scenario - Kontrast fuer grosse Schrift zu gering: {0:N1}:1" -f (Get-GuiContrastRatio $primary $rightAverage))
        # Auch der hellste gemessene Bildpunkt unter der Flaeche darf den Kontrast nicht unter 4.5 druecken.
        $brightest = $rightAverage
        for ($y = $content.Top; $y -lt $content.Bottom; $y += 16) {
            for ($x = $content.Left; $x -lt $content.Right; $x += 16) {
                $pixel = $shell.BackdropBitmap.GetPixel($x, $y)
                if ((Get-GuiRelativeLuminance $pixel) -gt (Get-GuiRelativeLuminance $brightest)) { $brightest = $pixel }
            }
        }
        Assert-True ($brightest.R -lt 96) "$Scenario - Flaeche wird vom Motiv zu stark aufgehellt (R=$($brightest.R))."
        Assert-True ((Get-GuiContrastRatio $primary $brightest) -ge 4.5) ("$Scenario - Kontrast am hellsten Punkt zu gering: {0:N1}:1" -f (Get-GuiContrastRatio $primary $brightest))

        # Der Text ist auch wirklich gezeichnet: im Titelband liegen helle Schriftpixel.
        $textPixels = 0
        for ($y = $shell.TitleLabel.Top; $y -lt ($shell.TitleLabel.Top + $shell.TitleLabel.Height); $y++) {
            for ($x = $shell.Content.Left; $x -lt ($shell.Content.Left + 320); $x++) {
                if ($bitmap.GetPixel($x, $y).R -gt 150) { $textPixels++ }
            }
        }
        Assert-True ($textPixels -ge 30) "$Scenario - Der Titel wird nicht sichtbar gezeichnet ($textPixels helle Pixel)."

        # 3c. Aufteilung und Footer entsprechen dem Vertrag.
        Assert-True ($shell.Content.Left -eq ($split + $script:GuiLayout.ContentPadding)) "$Scenario - Inhaltsbereich beginnt nicht am Vertragspunkt."
        Assert-True ($shell.Content.Top -eq $script:GuiLayout.ContentTop) "$Scenario - Inhaltsbereich beginnt nicht oben am Vertragspunkt."
        Assert-True ($shell.Footer.Height -eq $script:GuiLayout.FooterHeight) "$Scenario - Footerhoehe weicht ab."
        Assert-True ($shell.Footer.Bottom -eq $Client.Height) "$Scenario - Footer schliesst nicht mit dem Fenster ab."
        Assert-True (($shell.PrimaryButton.Right + $script:GuiLayout.ContentPadding) -eq $Client.Width) "$Scenario - Hauptaktion ist nicht rechtsbuendig."
        foreach ($button in @($shell.PrimaryButton, $shell.BackButton, $shell.CancelButton)) {
            Assert-True ($button.Parent -eq $shell.Footer) "$Scenario - Aktion liegt nicht im Footer."
            Assert-True ($button.Height -eq $script:GuiLayout.ButtonHeight) "$Scenario - Aktionshoehe weicht ab."
            Assert-True ($button.Left -ge 0 -and $button.Right -le $shell.Footer.Width) "$Scenario - Aktion ragt aus dem Footer."
        }

        # 3d. Genau ein Fortschrittsbalken und genau eine Detailansicht.
        $all = New-Object System.Collections.ArrayList
        $collect = { param($control) [void]$all.Add($control); foreach ($child in $control.Controls) { & $collect $child } }
        & $collect $shell.Panel
        $bars = @($all | Where-Object { $_ -is [System.Windows.Forms.ProgressBar] })
        $links = @($all | Where-Object { $_ -is [System.Windows.Forms.LinkLabel] })
        Assert-True ($bars.Count -eq 1) "$Scenario - Es gibt $($bars.Count) Fortschrittsbalken statt einem."
        Assert-True ($links.Count -eq 1 -and $links[0].Text -eq $script:GuiLayout.DetailsHint) "$Scenario - Die Detailansicht fehlt oder ist mehrfach vorhanden."
        Assert-True ($bars[0].Visible) "$Scenario - Waehrend technischer Arbeit fehlt der Fortschrittsbalken."
        Assert-True ($bars[0].Value -eq 40) "$Scenario - Der Fortschrittswert wird nicht angezeigt."
        Assert-True ($links[0].Visible) "$Scenario - Details sind waehrend technischer Arbeit nicht erreichbar."

        # 3e. Kein Bedienelement ragt aus der Flaeche.
        foreach ($control in $all) {
            if ($control -eq $shell.Panel) { continue }
            $parent = $control.Parent
            Assert-True ($control.Left -ge 0 -and $control.Top -ge 0) "$Scenario - $($control.Name) beginnt ausserhalb seines Bereichs."
            Assert-True (($control.Left + $control.Width) -le ($parent.ClientSize.Width + 2)) "$Scenario - $($control.Name) ragt rechts heraus."
            Assert-True (($control.Top + $control.Height) -le ($parent.ClientSize.Height + 2)) "$Scenario - $($control.Name) ragt unten heraus."
        }

        # 3f. Tastatur: Standardaktionen gebunden, jede Aktion erreichbar, Balken nicht fokussierbar.
        Assert-True ($form.AcceptButton -eq $shell.PrimaryButton) "$Scenario - Enter ist nicht an die Hauptaktion gebunden."
        Assert-True ($form.CancelButton -eq $shell.CancelButton) "$Scenario - Escape ist nicht an Abbrechen gebunden."
        foreach ($control in @($shell.PrimaryButton, $shell.BackButton, $shell.CancelButton, $shell.DetailsLink)) {
            Assert-True ($control.TabStop) "$Scenario - $($control.Name) ist nicht per Tabulator erreichbar."
            Assert-True ($control.Enabled) "$Scenario - $($control.Name) ist nicht bedienbar."
        }
        Assert-True (-not $bars[0].TabStop) "$Scenario - Der Fortschrittsbalken ist faelschlich fokussierbar."
        $tabOrder = @($shell.Footer.Controls | Where-Object { $_.TabStop } | Sort-Object TabIndex | ForEach-Object { $_.Name })
        Assert-True ($tabOrder.Count -eq 3) "$Scenario - Footer hat $($tabOrder.Count) fokussierbare Aktionen."
    } finally {
        $bitmap.Dispose()
        $form.Close()
        $form.Dispose()
        if ($shell.BackdropBitmap) { $shell.BackdropBitmap.Dispose() }
    }
}

Test-Shell (New-Object System.Drawing.Size(1200, 760)) 'Standardgroesse'
Test-Shell (New-Object System.Drawing.Size(1024, 680)) 'Mindestgroesse'

# --- 4. Fehlendes Bild: verstaendlicher Zustand, Ersatzflaeche, kein Absturz
$fallbackShell = New-GuiShell -BackdropPath (Join-Path $env:TEMP ('fehlt-' + [guid]::NewGuid().ToString('N') + '.png'))
try {
    Assert-True ($fallbackShell.Backdrop.Fallback) 'Fehlendes Bild wurde nicht als Ersatzfall erkannt.'
    Assert-True ($fallbackShell.Backdrop.Notice.Length -gt 10) 'Der Ersatzfall nennt keinen Grund.'
    $fallbackColor = Get-GuiColor $script:GuiLayout.FallbackSurface
    $pixel = $fallbackShell.BackdropBitmap.GetPixel(200, 150)
    Assert-True ([math]::Abs($pixel.R - $fallbackColor.R) -le 2 -and [math]::Abs($pixel.G - $fallbackColor.G) -le 2 -and [math]::Abs($pixel.B - $fallbackColor.B) -le 2) "Ersatzflaeche hat die falsche Farbe: $($pixel.ToString())."
    Assert-True ((Get-GuiContrastRatio (Get-GuiColor $script:GuiLayout.PrimaryText) $fallbackColor) -ge 4.5) 'Kontrast auf der Ersatzflaeche ist zu gering.'
} finally {
    $fallbackShell.Form.Dispose()
    if ($fallbackShell.BackdropBitmap) { $fallbackShell.BackdropBitmap.Dispose() }
}

# --- 5. Umgebungsunabhaengigkeit: der Rahmen braucht weder Node noch Python
$shellSource = [IO.File]::ReadAllText((Join-Path $gui 'shell.ps1')) + [IO.File]::ReadAllText((Join-Path $gui 'background.ps1')) + [IO.File]::ReadAllText((Join-Path $gui 'layout.ps1'))
foreach ($forbidden in @('node.exe', 'python.exe', 'pnpm.cmd', 'npm.cmd', 'py -3')) {
    Assert-True ($shellSource -notmatch [regex]::Escape($forbidden)) "Der Rahmen haengt an '$forbidden'."
}

Write-Host "Assistent-Oberflaeche: PASS ($script:checks Zusicherungen, Screenshots in $env:TEMP\friday-shell-*.png)"