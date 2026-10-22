# Safe GUI/backend protocol test. No installation, restart, downloads, or API calls.
$gui = Join-Path $PSScriptRoot '..\install-friday-gui.ps1'
$backend = Join-Path $PSScriptRoot '..\install-friday.ps1'
foreach ($file in @($gui, $backend)) {
    $tokens = $null; $errors = $null
    [void][Management.Automation.Language.Parser]::ParseFile((Resolve-Path $file), [ref]$tokens, [ref]$errors)
    if ($errors.Count) { throw "PowerShell syntax error in $file : $($errors[0].Message)" }
}
$tokens = $null; $errors = $null
$ast = [Management.Automation.Language.Parser]::ParseFile((Resolve-Path $backend), [ref]$tokens, [ref]$errors)
foreach ($name in @('Gui-Secret','Plain')) {
    $definition = $ast.Find({ param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq $name }, $true)
    if (-not $definition) { throw "Backend helper missing: $name" }
    Invoke-Expression $definition.Extent.Text
}
$synthetic = ConvertTo-SecureString -String 'synthetic-test-password' -AsPlainText -Force
$script:GuiConfig = [pscustomobject]@{ secrets = [pscustomobject]@{ linuxPassword = (ConvertFrom-SecureString $synthetic) } }
$decoded = Plain (Gui-Secret 'linuxPassword')
if ($decoded -cne 'synthetic-test-password') { throw 'DPAPI roundtrip failed.' }
$script:GuiConfig.secrets.linuxPassword = 'corrupt-ciphertext'
$rejected = $false
try { [void](Gui-Secret 'linuxPassword') } catch { $rejected = $true }
if (-not $rejected) { throw 'Corrupt DPAPI ciphertext was accepted.' }
$synthetic.Dispose(); $decoded = $null; $script:GuiConfig = $null
# Der Assistent akzeptiert -Simulation nur im Testmodus; dieser Test ist der Testmodus.
$env:FRIDAY_GUI_TEST = '1'
foreach ($case in @(@{ mode='success'; expected=0 }, @{ mode='failure'; expected=1 }, @{ mode='restart'; expected=10 })) {
    $result = & powershell.exe -NoProfile -STA -ExecutionPolicy Bypass -File $gui -Simulation $case.mode 2>&1 | Out-String
    if ($result -notmatch "GUI_TEST mode=$($case.mode) exit=$($case.expected)") { throw "Unexpected GUI result for $($case.mode): $result" }
    $screenshot = Join-Path $env:TEMP "friday-gui-$($case.mode).png"
    if (-not (Test-Path -LiteralPath $screenshot -PathType Leaf)) { throw "Missing rendered screenshot: $screenshot" }
}
foreach ($page in 0..6) {
    if (-not (Test-Path -LiteralPath (Join-Path $env:TEMP "friday-gui-page-$page.png") -PathType Leaf)) { throw "Page $page did not render." }
}
if (-not (Test-Path -LiteralPath (Join-Path $env:TEMP 'friday-gui-cloud.png') -PathType Leaf)) { throw 'ElevenLabs page did not render.' }
$privateDir = Join-Path $env:LOCALAPPDATA 'FridayInstaller'
if (@(Get-ChildItem -LiteralPath $privateDir -Filter '*.json' -ErrorAction SilentlyContinue).Count) { throw 'GUI credential transport file was not deleted.' }

# Malformed configuration must fail before the installer creates or changes an installation.
$bad = Join-Path $privateDir (([guid]::NewGuid().ToString('N')) + '.json')
[IO.File]::WriteAllText($bad, '{"protocol":0}', (New-Object Text.UTF8Encoding $false))
try {
    $result = & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $backend -GuiConfigPath $bad -GuiSimulation 2>&1 | Out-String
    if ($result -notmatch 'Unbekanntes GUI-Protokoll' -or $LASTEXITCODE -eq 0) { throw "Malformed protocol was accepted: $result" }
    if (Test-Path -LiteralPath $bad) { throw 'Malformed GUI credential transport file was not deleted.' }
} finally { Remove-Item -LiteralPath $bad -Force -ErrorAction SilentlyContinue }
Write-Output 'GUI protocol success/failure/restart, rendering, DPAPI, cleanup, malformed input: PASS'
