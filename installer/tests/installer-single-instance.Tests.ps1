# Beweist am echten Einstiegspunkt: waehrend ein anderer Prozess die Installersperre haelt, endet
# install-friday.ps1 sofort mit Exitcode 20 und aendert nichts. Ohne Halter laeuft es normal weiter
# (bis zur erwarteten Meldung fuer ein gezieltes Update ohne bestehende Installation).
$ErrorActionPreference = 'Stop'
$lib = Join-Path $PSScriptRoot '..\lib\installer-lock.ps1'
$installer = Join-Path $PSScriptRoot '..\install-friday.ps1'
. $lib

$fixture = Join-Path ([IO.Path]::GetTempPath()) ("friday single instance-" + [guid]::NewGuid().ToString('N').Substring(0, 8))
$root = Join-Path $fixture 'Ziel ordner ü'
$holderScript = Join-Path $fixture 'holder.ps1'
$instances = @()

function Invoke-Installer([string]$Root, [string]$Tag) {
    $stdout = Join-Path $fixture "$Tag.out.txt"
    $stderr = Join-Path $fixture "$Tag.err.txt"
    # cmd liefert den echten Exitcode (Start-Process -PassThru gibt ihn mit umgeleiteten Stroemen
    # nicht zurueck) und "< nul" beantwortet ein etwaiges Read-Host ohne Haenger.
    $command = "powershell.exe -NoProfile -ExecutionPolicy Bypass -File `"$installer`" -InstallRoot `"$Root`" -UpdateDashboard < nul > `"$stdout`" 2> `"$stderr`""
    & cmd.exe /c $command
    return @{
        Code = $LASTEXITCODE
        Out = (Get-Content -LiteralPath $stdout -Raw -Encoding UTF8 -ErrorAction SilentlyContinue)
        Err = (Get-Content -LiteralPath $stderr -Raw -Encoding UTF8 -ErrorAction SilentlyContinue)
    }
}

try {
    New-Item -ItemType Directory -Force -Path $fixture | Out-Null
    New-Item -ItemType Directory -Force -Path $root | Out-Null

    # Halter: nimmt dieselbe Sperre wie der Installer und wartet auf die Freigabedatei.
    $holder = @'
param([string]$Lib, [string]$Root, [string]$Ready, [string]$Release)
$ErrorActionPreference = 'Stop'
. $Lib
$lock = Enter-InstallerLock -Root $Root -RunId 'halten' -Mode 'probe'
if (-not $lock.Acquired) { [IO.File]::WriteAllText($Ready, 'belegt'); exit 3 }
[IO.File]::WriteAllText($Ready, 'bereit')
$until = (Get-Date).AddSeconds(45)
while (-not (Test-Path -LiteralPath $Release) -and (Get-Date) -lt $until) { Start-Sleep -Milliseconds 100 }
Exit-InstallerLock $lock
exit 0
'@
    [IO.File]::WriteAllText($holderScript, $holder, (New-Object System.Text.UTF8Encoding($true)))

    $ready = Join-Path $fixture 'ready.txt'
    $release = Join-Path $fixture 'release.txt'
    $instances += Start-Process -FilePath 'powershell.exe' -PassThru -WindowStyle Hidden -ArgumentList @(
        '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', "`"$holderScript`"",
        '-Lib', "`"$lib`"", '-Root', "`"$root`"", '-Ready', "`"$ready`"", '-Release', "`"$release`"")

    $deadline = (Get-Date).AddSeconds(20)
    while (-not (Test-Path -LiteralPath $ready) -and (Get-Date) -lt $deadline) { Start-Sleep -Milliseconds 100 }
    if (-not (Test-Path -LiteralPath $ready)) { throw 'Halter meldete die Sperre nicht.' }
    if ((Get-Content -LiteralPath $ready -Raw).Trim() -ne 'bereit') { throw 'Halter bekam die Sperre nicht.' }

    $blocked = Invoke-Installer -Root $root -Tag 'belegt'
    if ($blocked.Code -ne $script:InstallerAlreadyRunningExitCode) {
        throw "Belegter Start endete mit Code $($blocked.Code) statt $($script:InstallerAlreadyRunningExitCode). Ausgabe: $($blocked.Out)"
    }
    if ($blocked.Out -notmatch '\[BELEGT\]') { throw "Belegter Start meldet die Sperre nicht: $($blocked.Out)" }
    if ($blocked.Out -notmatch "PID $($instances[0].Id)") { throw "Belegter Start nennt die PID des Halters nicht: $($blocked.Out)" }
    if ($blocked.Out -match 'Keine bestehende Installation') { throw 'Belegter Start hat die Installation trotzdem begonnen.' }
    if ($blocked.Out -match 'Start-Transcript') { throw 'Belegter Start hat ein Protokoll begonnen.' }
    if (Test-Path -LiteralPath (Join-Path $root 'resume.bat')) { throw 'Belegter Start hat eine Fortsetzungsdatei geschrieben.' }

    [IO.File]::WriteAllText($release, 'frei')
    if (-not $instances[0].WaitForExit(30000)) { $instances[0].Kill(); throw 'Halter beendete sich nicht.' }
    if ($instances[0].ExitCode -ne 0) { throw "Halter endete mit Code $($instances[0].ExitCode)." }
    if (Test-Path -LiteralPath (Get-InstallerLockPath $root)) { throw 'Sperrdatei blieb nach dem Halter liegen.' }

    # Ohne Halter laeuft derselbe Aufruf weiter bis zur erwarteten Meldung (kein Fehlalarm durch die Sperre).
    $free = Invoke-Installer -Root $root -Tag 'frei'
    if ($free.Code -eq $script:InstallerAlreadyRunningExitCode) { throw 'Freier Start wurde faelschlich als belegt abgewiesen.' }
    if ($free.Out -notmatch 'Keine bestehende Installation') { throw "Freier Start erreichte die erwartete Pruefung nicht: $($free.Out) $($free.Err)" }
    if (Test-Path -LiteralPath (Get-InstallerLockPath $root)) { throw 'Sperrdatei blieb nach dem freien Start liegen.' }

    Write-Host 'Einzelinstanz am echten Einstiegspunkt: PASS'
} finally {
    foreach ($process in $instances) {
        if ($process -and -not $process.HasExited) { try { $process.Kill() } catch { } }
    }
    $resolved = [IO.Path]::GetFullPath($fixture)
    $tempRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\') + '\'
    if (-not $resolved.StartsWith($tempRoot, [StringComparison]::OrdinalIgnoreCase) -or
        -not ([IO.Path]::GetFileName($resolved)).StartsWith('friday single instance-')) { throw "Unsicherer Testpfad: $resolved" }
    if (Test-Path -LiteralPath $resolved) { Remove-Item -LiteralPath $resolved -Recurse -Force }
}