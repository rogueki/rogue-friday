$ErrorActionPreference = 'Stop'
# Regression 2026-11-01: Invoke-CapturedProcess writes stdin verbatim; "user`npassword" without a final newline made
# 'read' in setup_root.sh (set -e) hit EOF, the script ended silently and every fresh install stopped in step 8.
function Assert-True([bool]$Condition, [string]$Message) { if (-not $Condition) { throw $Message } }
$installerDir = Split-Path $PSScriptRoot -Parent
. (Join-Path $installerDir 'lib\process-supervisor.ps1')

$bash = @("$env:ProgramFiles\Git\bin\bash.exe", "${env:ProgramFiles(x86)}\Git\bin\bash.exe") | Where-Object { $_ -and (Test-Path -LiteralPath $_) } | Select-Object -First 1
Assert-True ([bool]$bash) 'Git-Bash fehlt; der Test braucht bash.exe.'

# --- 1. The real head of setup_root.sh (input handling up to the name check) with both input forms.
$script = [IO.File]::ReadAllText((Join-Path $installerDir 'wsl\setup_root.sh'))
$headEnd = $script.IndexOf('echo "==> Systempakete"')
Assert-True ($headEnd -gt 0) 'setup_root.sh: Beginn der Paketinstallation nicht gefunden.'
$probe = Join-Path ([IO.Path]::GetTempPath()) ("friday-root-head-" + [guid]::NewGuid().ToString('N') + '.sh')
try {
    $text = $script.Substring(0, $headEnd).Replace("`r`n", "`n") + "echo `"GOT U=`$U PWLEN=`${#PW}`"`necho HEAD_DONE`n"
    [IO.File]::WriteAllText($probe, $text, (New-Object Text.UTF8Encoding($false)))
    $probeUnix = '/' + $probe.Substring(0, 1).ToLower() + $probe.Substring(2).Replace('\', '/')
    foreach ($case in @(@{ Name = 'ohne Zeilenumbruch'; In = "probeuser`nsecret" }, @{ Name = 'mit Zeilenumbruch'; In = "probeuser`nsecret`n" })) {
        $run = Invoke-CapturedProcess -FilePath $bash -Arguments @('--noprofile', '--norc', $probeUnix) -TimeoutSeconds 60 -StdIn $case.In
        Assert-True ($run.ExitCode -eq 0) "setup_root.sh endet bei Eingabe $($case.Name) mit Exitcode $($run.ExitCode): $($run.StdErr)"
        Assert-True ("$($run.StdOut)" -match 'GOT U=probeuser PWLEN=6') "setup_root.sh liest Eingabe $($case.Name) falsch: $($run.StdOut)"
    }
} finally { Remove-Item -LiteralPath $probe -Force -ErrorAction SilentlyContinue }

# --- 1b. Stdin goes out as UTF-8, not the console code page: "päss€" must reach bash as UTF-8 bytes.
$encProbe = Join-Path ([IO.Path]::GetTempPath()) ("friday-stdin-enc-" + [guid]::NewGuid().ToString('N') + '.sh')
try {
    [IO.File]::WriteAllText($encProbe, "IFS= read -r PW || true`nprintf '%s' `"`$PW`" | od -An -tx1`n", (New-Object Text.UTF8Encoding($false)))
    $encUnix = '/' + $encProbe.Substring(0, 1).ToLower() + $encProbe.Substring(2).Replace('\', '/')
    $secret = 'p' + [char]0xE4 + 'ss' + [char]0x20AC + "`n"
    $run = Invoke-CapturedProcess -FilePath $bash -Arguments @('--noprofile', '--norc', $encUnix) -TimeoutSeconds 60 -StdIn $secret
    $hex = (("$($run.StdOut)" -split '\s+') | Where-Object { $_ }) -join ' '
    Assert-True ($hex -eq '70 c3 a4 73 73 e2 82 ac') "Eingabe kommt nicht als UTF-8 an: $hex"
} finally { Remove-Item -LiteralPath $encProbe -Force -ErrorAction SilentlyContinue }

# --- 2. Wsl-Run always ends stdin with a newline (helper scripts besides setup_root.sh rely on line input too).
$installer = [IO.File]::ReadAllText((Join-Path $installerDir 'install-friday.ps1'))
Assert-True ($installer -match 'if \(\$StdIn -and -not \$StdIn\.EndsWith\("`n"\)\) \{ \$StdIn \+= "`n" \}') 'Wsl-Run schliesst die Eingabe nicht mit einem Zeilenumbruch ab.'

# --- 3. A failed WSL setup step names the reason in the stop message (the GUI shows only that message).
$tokens = $null; $errors = $null
$ast = [Management.Automation.Language.Parser]::ParseInput($installer, [ref]$tokens, [ref]$errors)
$tailFn = $ast.Find({ param($n) $n -is [Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq 'Get-WslFailureTail' }, $true)
Assert-True ([bool]$tailFn) 'Get-WslFailureTail fehlt.'
. ([scriptblock]::Create($tailFn.Extent.Text))
$tail = Get-WslFailureTail ("==> Systempakete`nE: Temporary failure resolving 'archive.ubuntu.com'`n`nFAIL apt-get update fehlgeschlagen")
Assert-True ($tail -match "Temporary failure resolving" -and $tail -match 'FAIL apt-get update') "Fehlermeldung zeigt die Ursache nicht: $tail"
Assert-True ((Get-WslFailureTail '') -match 'Keine Ausgabe') 'Leere Ausgabe wird nicht benannt.'
foreach ($marker in @('ROOT_SETUP_DONE', 'HERMES_SETUP_DONE', 'VOICE_SETUP_DONE')) {
    $line = @($installer -split "`r?`n" | Where-Object { $_ -match "-notmatch '$marker'" -and $_ -match 'Stop-Install' })
    Assert-True ($line.Count -eq 1 -and $line[0] -match 'Get-WslFailureTail') "Abbruch bei fehlendem $marker nennt keine Ursache."
}
Write-Output 'WSL-Eingabe und Fehlermeldungen: PASS'
