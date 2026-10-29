# Anzeigeskalierung: 125, 150 und 200 Prozent muessen ohne Ueberlauf, mit lesbarem Kontrast und mit
# vollstaendig sichtbaren Aktionen funktionieren. Gemessen wird am gezeichneten Fenster jeder Stufe.
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

if ([System.Threading.Thread]::CurrentThread.GetApartmentState() -ne 'STA') {
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

$primary = Get-GuiColor $script:GuiLayout.PrimaryText
$secondary = Get-GuiColor $script:GuiLayout.SecondaryText

# --- 1. Rechnung je Stufe
foreach ($scale in @(1.0, 1.25, 1.5, 2.0)) {
    $client = New-Object System.Drawing.Size([int](1200 * $scale), [int](760 * $scale))
    $layout = Get-GuiLayout $client $scale
    $tag = "$([int]($scale * 100))%"
    Assert-True ($layout.Scale -eq $scale) "$tag - Skalierung wird nicht uebernommen."
    Assert-True ($layout.Padding -eq [int][math]::Round(32 * $scale)) "$tag - Innenabstand ist $($layout.Padding) statt $([int](32 * $scale))."
    Assert-True ($layout.FooterHeight -eq [int][math]::Round(80 * $scale)) "$tag - Footerhoehe ist $($layout.FooterHeight)."
    Assert-True ($layout.ContentTop -eq [int][math]::Round(36 * $scale)) "$tag - Inhaltsbeginn ist $($layout.ContentTop)."
    Assert-True ($layout.Content.Left -eq ($layout.SplitX + $layout.Padding)) "$tag - Inhalt beginnt nicht hinter der Bildspalte."
    Assert-True ($layout.Content.Right -le $client.Width) "$tag - Inhalt ragt rechts heraus."
    Assert-True ($layout.Footer.Bottom -eq $client.Height) "$tag - Footer schliesst nicht ab."
    Assert-True ($layout.Content.Width -gt 200 -and $layout.Content.Height -gt 200) "$tag - Inhalt ist zu klein ($($layout.Content.Width)x$($layout.Content.Height))."

    # Mindestgroesse derselben Stufe: der Vertrag muss auch dort aufgehen.
    $minClient = New-Object System.Drawing.Size([int](1024 * $scale), [int](680 * $scale))
    $minLayout = Get-GuiLayout $minClient $scale
    Assert-True ($minLayout.Content.Width -gt 200 -and $minLayout.Content.Height -gt 100) "$tag - Inhalt ist bei Mindestgroesse zu klein."
    Assert-True ($minLayout.Footer.Bottom -eq $minClient.Height) "$tag - Footer fehlt bei Mindestgroesse."
}
Assert-True ((Get-GuiLayout (New-Object System.Drawing.Size(1200, 760))).Padding -eq 32) 'Ohne Skalierung aendert sich der Vertrag.'

# --- 2. Gezeichnetes Fenster je Stufe
foreach ($scale in @(1.25, 1.5, 2.0)) {
    $tag = "$([int]($scale * 100))%"
    $client = New-Object System.Drawing.Size([int](1200 * $scale), [int](760 * $scale))
    $shell = New-GuiShell -ClientSize $client -Scale $scale
    $shell.Content.BackColor = [System.Drawing.Color]::Transparent
    foreach ($label in @($shell.StepLabel, $shell.TitleLabel, $shell.BodyLabel)) { $label.BackColor = [System.Drawing.Color]::Transparent }
    $shell.Footer.BackColor = [System.Drawing.Color]::Transparent
    Set-GuiShellPage $shell 'Schritt 1 von 8' 'Willkommen bei F.R.I.D.A.Y.' 'Der Assistent fuehrt durch die Einrichtung; ein Terminal ist nicht noetig.' $true 40
    $form = $shell.Form
    $form.Show()
    [System.Windows.Forms.Application]::DoEvents()
    Start-Sleep -Milliseconds 200
    [System.Windows.Forms.Application]::DoEvents()
    $bitmap = New-Object System.Drawing.Bitmap($shell.Panel.Width, $shell.Panel.Height)
    try {
        $shell.Panel.DrawToBitmap($bitmap, (New-Object System.Drawing.Rectangle(0, 0, $bitmap.Width, $bitmap.Height)))
        $bitmap.Save((Join-Path $env:TEMP ("friday-shell-dpi-$([int]($scale * 100)).png")))

        # Bild links sichtbar
        $leftColors = @{}
        for ($y = 6; $y -lt ($client.Height - 6); $y += [int](12 * $scale)) {
            for ($x = 6; $x -lt ($shell.Layout.SplitX - 6); $x += [int](12 * $scale)) { $leftColors[$bitmap.GetPixel($x, $y).ToArgb()] = $true }
        }
        Assert-True ($leftColors.Count -ge 20) "$tag - links ist kein Bild sichtbar ($($leftColors.Count) Farben)."

        # Kontrast auf dem Hintergrundmaterial der rechten Flaeche
        $sum = @{ R = 0; G = 0; B = 0; N = 0 }
        $contentRect = $shell.Layout.Content
        for ($y = $contentRect.Top; $y -lt $contentRect.Bottom; $y += 8) {
            for ($x = $contentRect.Left; $x -lt $contentRect.Right; $x += 8) {
                $pixel = $shell.BackdropBitmap.GetPixel($x, $y)
                $sum.R += $pixel.R; $sum.G += $pixel.G; $sum.B += $pixel.B; $sum.N++
            }
        }
        $average = [System.Drawing.Color]::FromArgb(255, [int]($sum.R / $sum.N), [int]($sum.G / $sum.N), [int]($sum.B / $sum.N))
        $contrastPrimary = Get-GuiContrastRatio $primary $average
        $contrastSecondary = Get-GuiContrastRatio $secondary $average
        Assert-True ($contrastPrimary -ge 7.0) ("$tag - Kontrast Titel zu gering: {0:N1}:1" -f $contrastPrimary)
        Assert-True ($contrastSecondary -ge 4.5) ("$tag - Kontrast Text zu gering: {0:N1}:1" -f $contrastSecondary)

        # Schrift wird in der skalierten Groesse gezeichnet
        $textPixels = 0
        for ($y = $shell.TitleLabel.Top; $y -lt ($shell.TitleLabel.Top + $shell.TitleLabel.Height); $y++) {
            for ($x = $shell.Content.Left; $x -lt [math]::Min($shell.Content.Right, $shell.Content.Left + [int](320 * $scale)); $x++) {
                if ($bitmap.GetPixel($x, $y).R -gt 150) { $textPixels++ }
            }
        }
        Assert-True ($textPixels -ge [int](30 * $scale)) "$tag - Titel wird nicht sichtbar gezeichnet ($textPixels Punkte)."

        # Aktionen: rechtsbuendig, senkrecht zentriert, vollstaendig in der Fusszeile
        $padding = $shell.Layout.Padding
        Assert-True (($shell.PrimaryButton.Right + $padding) -eq $client.Width) "$tag - Hauptaktion ist nicht rechtsbuendig."
        foreach ($action in @($shell.PrimaryButton, $shell.BackButton, $shell.CancelButton)) {
            Assert-True ($action.Top -ge 0 -and ($action.Top + $action.Height) -le $shell.Footer.Height) "$tag - $($action.Name) ragt aus der Fusszeile."
            Assert-True ([math]::Abs(($action.Top + $action.Height / 2) - ($shell.Footer.Height / 2)) -le 2) "$tag - $($action.Name) ist nicht senkrecht zentriert."
            Assert-True ($action.Height -ge [int](34 * $scale)) "$tag - $($action.Name) ist fuer die Stufe zu niedrig ($($action.Height) px)."
        }

        # Kein Bedienelement ausserhalb seines Bereichs
        $all = New-Object System.Collections.ArrayList
        $collect = { param($control) [void]$all.Add($control); foreach ($child in $control.Controls) { & $collect $child } }
        & $collect $shell.Panel
        foreach ($control in $all) {
            if ($control -eq $shell.Panel) { continue }
            Assert-True (($control.Left + $control.Width) -le ($control.Parent.ClientSize.Width + 2)) "$tag - $($control.Name) ragt rechts heraus."
            Assert-True (($control.Top + $control.Height) -le ($control.Parent.ClientSize.Height + 2)) "$tag - $($control.Name) ragt unten heraus."
        }
    } finally {
        $bitmap.Dispose()
        $form.Close()
        $form.Dispose()
        if ($shell.BackdropBitmap) { $shell.BackdropBitmap.Dispose() }
    }
}

Write-Host "Anzeigeskalierung: PASS ($script:checks Zusicherungen, Stufen 125/150/200 Prozent gezeichnet)"