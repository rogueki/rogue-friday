# Rahmen des Assistenten: Originalbild links, Arbeitsflaeche rechts, Footer mit Aktionen.
# Die Seiten werden spaeter in den Inhaltsbereich gehaengt; dieser Rahmen kennt nur den Vertrag aus
# installer/gui/layout.ps1.

function Update-GuiShellBackdrop($Shell) {
    # Setzt das fertig zusammengesetzte Hintergrundbild in der aktuellen Clientgroesse.
    $size = $Shell.Panel.ClientSize
    if ($size.Width -le 0 -or $size.Height -le 0) { return }
    $layout = Get-GuiLayout $size
    $Shell.Layout = $layout
    $bitmap = New-GuiBackdropBitmap $Shell.Backdrop $size $layout.SplitX
    $previous = $Shell.Panel.BackgroundImage
    $Shell.Panel.BackgroundImage = $bitmap
    $Shell.Panel.BackgroundImageLayout = [System.Windows.Forms.ImageLayout]::Stretch
    $Shell.BackdropBitmap = $bitmap
    if ($previous) { $previous.Dispose() }
    $Shell.Content.Location = $layout.Content.Location
    $Shell.Content.Size = $layout.Content.Size
    $Shell.Footer.Location = $layout.Footer.Location
    $Shell.Footer.Size = $layout.Footer.Size
    $Shell.PrimaryButton.Left = $Shell.Footer.Width - $script:GuiLayout.ContentPadding - $Shell.PrimaryButton.Width
    $Shell.BackButton.Left = $Shell.PrimaryButton.Left - $script:GuiLayout.ButtonGap - $Shell.BackButton.Width
    $Shell.CancelButton.Left = $script:GuiLayout.ContentPadding
    $Shell.ProgressBar.Width = $Shell.Content.Width
    $Shell.Panel.Invalidate()
}

function New-GuiShell {
    param(
        [string]$BackdropPath = (Join-Path $PSScriptRoot '..\assets\installer_background.png'),
        [string[]]$AdditionalBackdropPaths = @(),
        [System.Drawing.Size]$ClientSize = (New-Object System.Drawing.Size(1200, 760))
    )
    Add-Type -AssemblyName System.Windows.Forms
    Add-Type -AssemblyName System.Drawing
    $backdrop = Resolve-GuiBackdrop -Path $BackdropPath -AdditionalPaths $AdditionalBackdropPaths

    $form = New-Object System.Windows.Forms.Form
    $form.Text = 'F.R.I.D.A.Y. Installation'
    $form.AutoScaleMode = [System.Windows.Forms.AutoScaleMode]::Dpi
    $form.ClientSize = $ClientSize
    $form.MinimumSize = New-Object System.Drawing.Size($script:GuiLayout.MinimumWidth, $script:GuiLayout.MinimumHeight)
    $form.StartPosition = [System.Windows.Forms.FormStartPosition]::CenterScreen
    $form.BackColor = Get-GuiColor $script:GuiLayout.Surface
    $form.KeyPreview = $true

    $panel = New-Object System.Windows.Forms.Panel
    $panel.Name = 'shellPanel'
    $panel.Dock = [System.Windows.Forms.DockStyle]::Fill
    $form.Controls.Add($panel)

    $layout = Get-GuiLayout $form.ClientSize
    $content = New-Object System.Windows.Forms.Panel
    $content.Name = 'contentPanel'
    $content.Location = $layout.Content.Location
    $content.Size = $layout.Content.Size
    # Deckende Flaeche in der Farbe des zu 94 % bedeckten Motivs: Text bleibt unabhaengig vom Bildmotiv
    # lesbar, und die gemessenen Kontraste gelten fuer die ganze Seite.
    $content.BackColor = Get-GuiColor $script:GuiLayout.Surface
    $content.AutoScroll = $true
    $panel.Controls.Add($content)

    $stepLabel = New-Object System.Windows.Forms.Label
    $stepLabel.Name = 'stepLabel'
    $stepLabel.Location = New-Object System.Drawing.Point(0, 0)
    $stepLabel.Size = New-Object System.Drawing.Size($content.Width, 22)
    $stepLabel.Font = New-GuiFont $script:GuiLayout.HelpSize
    $stepLabel.ForeColor = Get-GuiColor $script:GuiLayout.SecondaryText
    $stepLabel.BackColor = $content.BackColor
    $content.Controls.Add($stepLabel)

    $titleLabel = New-Object System.Windows.Forms.Label
    $titleLabel.Name = 'titleLabel'
    $titleLabel.Location = New-Object System.Drawing.Point(0, 28)
    $titleLabel.Size = New-Object System.Drawing.Size($content.Width, 44)
    $titleLabel.Font = New-GuiFont $script:GuiLayout.TitleSize ([System.Drawing.FontStyle]::Bold)
    $titleLabel.ForeColor = Get-GuiColor $script:GuiLayout.PrimaryText
    $titleLabel.BackColor = $content.BackColor
    $titleLabel.TabStop = $true
    $content.Controls.Add($titleLabel)

    $bodyLabel = New-Object System.Windows.Forms.Label
    $bodyLabel.Name = 'bodyLabel'
    $bodyLabel.Location = New-Object System.Drawing.Point(0, 78)
    $bodyLabel.Size = New-Object System.Drawing.Size($content.Width, 64)
    $bodyLabel.Font = New-GuiFont $script:GuiLayout.BodySize
    $bodyLabel.ForeColor = Get-GuiColor $script:GuiLayout.SecondaryText
    $bodyLabel.BackColor = $content.BackColor
    $content.Controls.Add($bodyLabel)

    $progress = New-Object System.Windows.Forms.ProgressBar
    $progress.Name = 'progressBar'
    $progress.Minimum = 0
    $progress.Maximum = 100
    $progress.Height = $script:GuiLayout.ProgressHeight
    $progress.Width = $content.Width
    $progress.Style = [System.Windows.Forms.ProgressBarStyle]::Continuous
    $progress.TabStop = $false
    $progress.Visible = $false
    $content.Controls.Add($progress)

    $detailsLink = New-Object System.Windows.Forms.LinkLabel
    $detailsLink.Name = 'detailsLink'
    $detailsLink.Text = $script:GuiLayout.DetailsHint
    $detailsLink.AutoSize = $true
    $detailsLink.LinkColor = Get-GuiColor $script:GuiLayout.Accent
    $detailsLink.ActiveLinkColor = Get-GuiColor $script:GuiLayout.Accent
    $detailsLink.BackColor = $content.BackColor
    $detailsLink.Font = New-GuiFont $script:GuiLayout.HelpSize
    $detailsLink.TabStop = $true
    $detailsLink.Visible = $false
    $content.Controls.Add($detailsLink)

    $footer = New-Object System.Windows.Forms.Panel
    $footer.Name = 'footer'
    $footer.Location = $layout.Footer.Location
    $footer.Size = $layout.Footer.Size
    $footer.BackColor = $content.BackColor
    $panel.Controls.Add($footer)

    $cancel = New-Object System.Windows.Forms.Button
    $cancel.Name = 'cancelButton'
    $cancel.Text = 'Abbrechen'
    $cancel.Size = New-Object System.Drawing.Size(120, $script:GuiLayout.ButtonHeight)
    $cancel.Font = New-GuiFont $script:GuiLayout.BodySize
    $cancel.BackColor = Get-GuiColor '#1F2937'
    $cancel.ForeColor = Get-GuiColor $script:GuiLayout.PrimaryText
    $cancel.FlatStyle = [System.Windows.Forms.FlatStyle]::Flat
    $cancel.FlatAppearance.BorderColor = Get-GuiColor '#374151'
    $footer.Controls.Add($cancel)

    $back = New-Object System.Windows.Forms.Button
    $back.Name = 'backButton'
    $back.Text = 'Zurück'
    $back.Size = New-Object System.Drawing.Size(120, $script:GuiLayout.ButtonHeight)
    $back.Font = New-GuiFont $script:GuiLayout.BodySize
    $back.BackColor = Get-GuiColor '#1F2937'
    $back.ForeColor = Get-GuiColor $script:GuiLayout.PrimaryText
    $back.FlatStyle = [System.Windows.Forms.FlatStyle]::Flat
    $back.FlatAppearance.BorderColor = Get-GuiColor '#374151'
    $footer.Controls.Add($back)

    $primary = New-Object System.Windows.Forms.Button
    $primary.Name = 'primaryButton'
    $primary.Text = 'Weiter'
    $primary.Size = New-Object System.Drawing.Size(140, $script:GuiLayout.ButtonHeight)
    $primary.Font = New-GuiFont $script:GuiLayout.BodySize ([System.Drawing.FontStyle]::Bold)
    $primary.BackColor = Get-GuiColor $script:GuiLayout.Accent
    $primary.ForeColor = Get-GuiColor '#0B1220'
    $primary.FlatStyle = [System.Windows.Forms.FlatStyle]::Flat
    $primary.FlatAppearance.BorderSize = 0
    $footer.Controls.Add($primary)

    $form.AcceptButton = $primary
    $form.CancelButton = $cancel

    $shell = [ordered]@{
        Form          = $form
        Panel         = $panel
        Content       = $content
        Footer        = $footer
        StepLabel     = $stepLabel
        TitleLabel    = $titleLabel
        BodyLabel     = $bodyLabel
        DetailsLink   = $detailsLink
        ProgressBar   = $progress
        PrimaryButton = $primary
        BackButton    = $back
        CancelButton  = $cancel
        Backdrop      = $backdrop
        Layout        = $layout
    }
    $form.Tag = $shell
    $form.Add_Shown({ param($sender, $eventArgs) Update-GuiShellBackdrop $sender.Tag; $sender.Invalidate($true) })
    $form.Add_Resize({ param($sender, $eventArgs) Update-GuiShellBackdrop $sender.Tag })
    Update-GuiShellBackdrop $shell
    return $shell
}

function Set-GuiShellPage($Shell, [string]$Step, [string]$Title, [string]$Body, [bool]$ShowProgress = $false, [int]$Percent = 0) {
    # Eine Seite setzt Schritttext, Titel und zwei erklaerende Saetze; der Balken erscheint nur
    # waehrend technischer Arbeit, sonst nirgends (kein zweiter Fortschrittsbereich).
    $Shell.StepLabel.Text = $Step
    $Shell.TitleLabel.Text = $Title
    $Shell.BodyLabel.Text = $Body
    $Shell.ProgressBar.Visible = $ShowProgress
    $Shell.DetailsLink.Visible = $ShowProgress
    if ($ShowProgress) { $Shell.ProgressBar.Value = [math]::Max(0, [math]::Min(100, $Percent)) }
    if ($ShowProgress) {
        $Shell.ProgressBar.Top = $Shell.BodyLabel.Top + $Shell.BodyLabel.Height + 12
        $Shell.DetailsLink.Top = $Shell.ProgressBar.Top + $Shell.ProgressBar.Height + 8
    } else {
        $Shell.DetailsLink.Top = $Shell.BodyLabel.Top + $Shell.BodyLabel.Height + 8
    }
    $Shell.DetailsLink.Left = 0
}