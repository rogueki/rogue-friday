#Requires -Version 5.1
param(
    [Parameter(Mandatory=$true)][string]$InstallRoot,
    [Parameter(Mandatory=$true)][string]$SourceRoot,
    [Parameter(Mandatory=$true)][string]$RunId,
    [ValidateSet('Apply','Rollback')][string]$Mode = 'Apply'
)
$ErrorActionPreference = 'Stop'
if ($RunId -cnotmatch '^[0-9a-f]{32}$') { throw 'Ungültige Voice-Update-ID.' }
$root = [IO.Path]::GetFullPath($InstallRoot).TrimEnd('\')
$source = [IO.Path]::GetFullPath($SourceRoot).TrimEnd('\')
$run = Join-Path $root "updates\voice-personas-$RunId"
$resultFile = Join-Path $run 'result.json'
$backupDir = Join-Path $run 'backup'
$pairs = @('friday-female','classic','custom')
$files = @(
    'voice\audio_devices.py', 'voice\audio_level.py', 'voice\audio_output.py', 'voice\browser_audio.py',
    'voice\build_personal_wake.py', 'voice\build_speaker_profile.py', 'voice\gui_interaction.py', 'voice\negative_texts.py',
    'voice\memory_outbox.py',
    'voice\calendar_voice.py', 'voice\cloudtalk_voice.py', 'voice\coding_voice.py',
    'voice\content_studio_voice.py', 'voice\cuda_dlls.py', 'voice\elevenlabs_cloud.py', 'voice\enroll_record.py',
    'voice\film_filter.py', 'voice\friday_voice.py', 'voice\mail_voice.py', 'voice\research_voice.py', 'voice\domain_task_voice.py',
    'voice\model_routing.py', 'voice\personal_wake.py', 'voice\powerpoint_voice.py', 'voice\runtime_settings.py', 'voice\speech_redaction.py',
    'voice\qwen_tts.py', 'voice\skills_onboarding_voice.py', 'voice\stt_models.py', 'voice\voice_persona.py', 'voice\wake_enrollment.py',
    'voice\voice_runtime_paths.py', 'voice\prepare_voice_pairs.py',
    'installer\fast_tts\server.py', 'installer\fast_tts\install_wsl.sh', 'installer\fast_tts\update_personas.sh',
    'installer\voice_models\friday_ref.wav', 'installer\voice_models\friday_ref.txt',
    'installer\voice_models\jarvis_ref.wav', 'installer\voice_models\jarvis_ref.txt'
)
$defaults = @(
    @{ Src='installer\voice_models\friday_ref.wav'; Dst='config\voice-references\friday-female-reference.wav' },
    @{ Src='installer\voice_models\friday_ref.txt'; Dst='config\voice-references\friday-female-reference.txt' },
    @{ Src='installer\voice_models\jarvis_ref.wav'; Dst='config\voice-references\classic-reference.wav' },
    @{ Src='installer\voice_models\jarvis_ref.txt'; Dst='config\voice-references\classic-reference.txt' }
)
function Write-Result([object]$value) {
    Assert-PathSafe $resultFile $root
    New-Item -ItemType Directory -Force -Path $run | Out-Null
    [IO.File]::WriteAllText($resultFile, ($value | ConvertTo-Json -Depth 6), [Text.UTF8Encoding]::new($false))
}
function Assert-Ordinary([string]$path) {
    $item = Get-Item -LiteralPath $path -Force -ErrorAction Stop
    if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw "Verknüpfung im Voice-Updatepfad: $path" }
    if ($item.PSIsContainer) { throw "Datei erwartet: $path" }
}
function Assert-PathSafe([string]$path, [string]$anchor) {
    $absolute = [IO.Path]::GetFullPath($path)
    $base = [IO.Path]::GetFullPath($anchor).TrimEnd('\')
    if (-not $absolute.StartsWith($base + '\', [StringComparison]::OrdinalIgnoreCase) -and
        -not $absolute.Equals($base, [StringComparison]::OrdinalIgnoreCase)) { throw "Voice-Updatepfad außerhalb der Installation: $path" }
    $current = $absolute
    while ($current.Length -ge $base.Length) {
        if (Test-Path -LiteralPath $current) {
            $item = Get-Item -LiteralPath $current -Force
            if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw "Verknüpfung im Voice-Updatepfad: $current" }
        }
        if ($current.Equals($base, [StringComparison]::OrdinalIgnoreCase)) { break }
        $current = Split-Path $current -Parent
    }
}
function Should-CopyDefault([hashtable]$default) {
    $target = Join-Path $root $default.Dst
    if (Test-Path -LiteralPath $target -PathType Leaf) { return $false }
    if ($default.Dst -notlike '*.txt') { return $true }
    $paired = [IO.Path]::ChangeExtension($target, '.wav')
    $bundled = Join-Path $source ([IO.Path]::ChangeExtension($default.Src, '.wav'))
    if (-not (Test-Path -LiteralPath $paired -PathType Leaf)) { return $true }
    return (Get-FileHash -LiteralPath $paired -Algorithm SHA256).Hash -eq (Get-FileHash -LiteralPath $bundled -Algorithm SHA256).Hash
}
function Voice-Procs {
    return @(Get-CimInstance Win32_Process -Filter "Name='powershell.exe' OR Name='cmd.exe' OR Name='python.exe'" -ErrorAction SilentlyContinue |
        Where-Object { $_.ProcessId -ne $PID -and $_.CommandLine -and $_.CommandLine.Contains($root + '\') -and
            ($_.CommandLine.Contains('start-friday-voice.ps1') -or $_.CommandLine.Contains('friday_voice.py')) })
}
function Voice-Health([string]$choice, [int]$timeoutSeconds, [bool]$allowLegacy = $false) {
    $cfg = Get-Content -LiteralPath (Join-Path $root 'config\voice.json') -Raw | ConvertFrom-Json
    $port = if ($cfg.health_port) { [int]$cfg.health_port } else { 43694 }
    $deadline = (Get-Date).AddSeconds($timeoutSeconds)
    do {
        try {
            $status = Invoke-RestMethod "http://127.0.0.1:$port/" -TimeoutSec 2
            if ($status.tts_voice_choice -eq $choice -or ($allowLegacy -and $status.state -and -not $status.tts_voice_choice)) { return $true }
        } catch { }
        Start-Sleep -Seconds 2
    } while ((Get-Date) -lt $deadline)
    return $false
}
function Stop-OwnVoice {
    $flag = Join-Path $root 'run\start-friday-voice.ps1.stop'
    Assert-PathSafe $flag $root
    New-Item -ItemType Directory -Force -Path (Split-Path $flag -Parent) | Out-Null
    Set-Content -LiteralPath $flag -Value stop -Encoding Ascii
    Stop-ScheduledTask -TaskName 'FRIDAY_Voice' -ErrorAction SilentlyContinue
    foreach ($round in 1..3) {
        $running = @(Voice-Procs)
        if ($running.Count -eq 0) { break }
        foreach ($process in @($running | Where-Object { $_.Name -eq 'powershell.exe' })) { Stop-Process -Id $process.ProcessId -Force -ErrorAction SilentlyContinue }
        foreach ($process in @($running | Where-Object { $_.Name -ne 'powershell.exe' })) { Stop-Process -Id $process.ProcessId -Force -ErrorAction SilentlyContinue }
        Start-Sleep -Seconds 2
    }
    if (@(Voice-Procs).Count -gt 0) { throw 'Alter Sprachdienst ließ sich nicht gezielt beenden.' }
    Remove-Item -LiteralPath $flag -Force -ErrorAction SilentlyContinue
}
function Start-OwnVoice([string]$choice, [bool]$allowLegacy = $false) {
    Start-ScheduledTask -TaskName 'FRIDAY_Voice' -ErrorAction Stop
    if (-not (Voice-Health $choice 180 $allowLegacy)) { throw 'Sprachdienst meldet nach Neustart nicht die vorherige Stimme.' }
}
function Invoke-NativeCaptured([string]$executable, [string[]]$arguments) {
    $previousPreference = $ErrorActionPreference
    try {
        # Native stderr is output, not a PowerShell terminating error. The process exit code decides success.
        $ErrorActionPreference = 'Continue'
        $lines = @(& $executable @arguments 2>&1 | ForEach-Object { [string]$_ })
        $exitCode = $LASTEXITCODE
    } finally {
        $ErrorActionPreference = $previousPreference
    }
    return [pscustomobject]@{ ExitCode = $exitCode; Lines = $lines }
}
function Wsl-Path([string]$path, [string]$distro, [string]$user) {
    $result = Invoke-NativeCaptured 'wsl.exe' @('-d', $distro, '-u', $user, '--exec', 'wslpath', '-a', '-u', $path)
    $translated = @($result.Lines | Where-Object { $_.StartsWith('/') } | Select-Object -First 1)
    if ($result.ExitCode -ne 0 -or $translated.Count -lt 1) { throw "WSL-Pfad nicht verfügbar: $path. $(($result.Lines | Select-Object -Last 2) -join ' ')" }
    return [string]$translated[0]
}
function Invoke-WslVoice([string]$action, [object]$state) {
    if (-not $state.wsl) { return }
    $scriptPath = Wsl-Path (Join-Path $source 'installer\fast_tts\update_personas.sh') $state.distro $state.user
    $args = @($scriptPath, $action, $RunId)
    if ($action -eq 'Apply') {
        $paths = @('installer\fast_tts\server.py',
            'config\voice-references\friday-female-streaming.wav', 'config\voice-references\friday-female-reference.txt',
            'config\voice-references\classic-streaming.wav', 'config\voice-references\classic-reference.txt')
        # Der eigene Platz ist optional: nur mitgeben, wenn die eigene Aufnahme wirklich vorbereitet wurde.
        $customPair = @('config\voice-references\custom-streaming.wav', 'config\voice-references\custom-reference.txt')
        if (@($customPair | Where-Object { Test-Path -LiteralPath (Join-Path $root $_) -PathType Leaf }).Count -eq 2) { $paths += $customPair }
        foreach ($relative in $paths) {
            $windows = if ($relative -like 'installer\*') { Join-Path $source $relative } else { Join-Path $root $relative }
            $args += Wsl-Path $windows $state.distro $state.user
        }
    }
    $result = Invoke-NativeCaptured 'wsl.exe' (@('-d', $state.distro, '-u', $state.user, '--exec', 'bash') + $args)
    if ($result.ExitCode -ne 0) { throw "WSL-TTS $action fehlgeschlagen (Exit $($result.ExitCode)): $(($result.Lines | Select-Object -Last 8) -join ' ')" }
}
function Invoke-MemoryUpgrade([string]$action) {
    $relative = 'installer/scripts/update-memory-bridge.ps1'
    $helper = Join-Path $source 'installer\scripts\update-memory-bridge.ps1'
    Assert-Ordinary $helper
    Assert-PathSafe $helper $source
    $tree = & git.exe -C $source ls-tree HEAD -- $relative
    if ($LASTEXITCODE -ne 0 -or $tree -notmatch '^100(644|755) blob ([0-9a-f]{40})\s') { throw 'Verifizierter Memory-Updater fehlt.' }
    $expected = $Matches[2]
    $actual = & git.exe -C $source hash-object --path=$relative -- $helper
    if ($LASTEXITCODE -ne 0 -or $actual.Trim() -cne $expected) { throw 'Memory-Updater entspricht nicht dem Git-Stand.' }
    $invoke = Invoke-NativeCaptured 'powershell.exe' @('-NoProfile','-ExecutionPolicy','Bypass','-File',$helper,
        '-InstallRoot',$root,'-SourceRoot',$source,'-RunId',$RunId,'-Mode',$action)
    if ($invoke.ExitCode -ne 0) { throw "Memory-Upgrade $action fehlgeschlagen." }
    $resultPath = Join-Path $root "updates\memory-bridge-$RunId\result.json"
    $result = Get-Content -LiteralPath $resultPath -Raw | ConvertFrom-Json
    $accepted = if ($action -eq 'Apply') { @('applied','runtimeNotConfigured') } else { @('rolledBack') }
    if ($result.status -notin $accepted) { throw "Memory-Upgrade $action ohne bestätigten Status." }
}
function Restore([object]$state) {
    $errors = [Collections.Generic.List[string]]::new()
    if ($state.memoryAttempted -and (Test-Path -LiteralPath (Join-Path $root "updates\memory-bridge-$RunId\manifest.json") -PathType Leaf)) {
        try { Invoke-MemoryUpgrade 'Rollback' } catch { $errors.Add("Memory: $($_.Exception.Message)") }
    }
    if ($state.wslAttempted -or $state.wslChanged) {
        try { Invoke-WslVoice 'Rollback' $state } catch { $errors.Add("WSL: $($_.Exception.Message)") }
    }
    try {
        if ($state.wasRunning) { Stop-OwnVoice }
        foreach ($entry in $state.files) {
            $target = Join-Path $root $entry.path
            $saved = Join-Path $backupDir $entry.path
            Assert-PathSafe $target $root
            Assert-PathSafe $saved $root
            if ($entry.existed) {
                Assert-Ordinary $saved
                New-Item -ItemType Directory -Force -Path (Split-Path $target -Parent) | Out-Null
                Copy-Item -LiteralPath $saved -Destination $target -Force
            } elseif (Test-Path -LiteralPath $target -PathType Leaf) {
                Assert-Ordinary $target
                Remove-Item -LiteralPath $target -Force
            }
        }
        if ($state.wasRunning) { Start-OwnVoice $state.voice $true }
    } catch { $errors.Add("Windows: $($_.Exception.Message)") }
    if ($errors.Count -gt 0) {
        $state.status = 'rollbackFailed'
        Write-Result $state
        throw ($errors -join '; ')
    }
    $state.status = 'rolledBack'
    Write-Result $state
}
if ($Mode -eq 'Rollback') {
    Assert-PathSafe $run $root
    if (-not (Test-Path -LiteralPath $resultFile -PathType Leaf)) { return }
    $state = Get-Content -LiteralPath $resultFile -Raw | ConvertFrom-Json
    if ($state.status -eq 'rolledBack') { return }
    Restore $state
    return
}
if (Test-Path -LiteralPath $resultFile -PathType Leaf) { throw 'Voice-Update-Lauf-ID wurde bereits verwendet.' }
if (-not (Test-Path -LiteralPath $root -PathType Container)) { throw 'Installationsordner fehlt.' }
Assert-PathSafe $run $root
$state = [pscustomobject]@{ status='starting'; voice=''; wasRunning=$false; wsl=$false; wslAttempted=$false; distro=''; user=''; files=@(); windowsChanged=$false; wslChanged=$false; memoryAttempted=$false }
$configured = Test-Path -LiteralPath (Join-Path $root 'config\voice.json') -PathType Leaf
if (-not $configured) { $files = @($files | Where-Object { $_ -like 'installer\voice_models\*' }) }
if ($configured) {
    $cfg = Get-Content -LiteralPath (Join-Path $root 'config\voice.json') -Raw | ConvertFrom-Json
    $state.voice = [string]$cfg.tts_voice_choice
    if ($state.voice -notin $pairs) { throw 'Installierte Stimme ist unbekannt; Voice-Update abgebrochen.' }
    $state.wasRunning = @(Voice-Procs).Count -gt 0
    $task = Get-ScheduledTask -TaskName 'FRIDAY_Voice' -ErrorAction Stop
    if (-not (($task.Actions | ForEach-Object { [string]$_.Arguments }) -join ' ').Contains($root + '\')) { throw 'Sprachdienst-Aufgabe gehört nicht zur Installation.' }
    if ($cfg.tts_backend -eq 'streaming_qwen') {
        $installState = Get-Content -LiteralPath (Join-Path $root 'config\install-state.json') -Raw | ConvertFrom-Json
        $state.distro = [string]$installState.distro_name
        $state.user = [string]$installState.linux_user
        if ($state.distro -notmatch '^[A-Za-z0-9_-]{1,64}$' -or $state.user -notmatch '^[a-z_][a-z0-9_-]{0,31}$') { throw 'WSL-Distribution oder Benutzer nicht lesbar.' }
        $state.wsl = $true
    }
}
New-Item -ItemType Directory -Force -Path $backupDir | Out-Null
try {
    foreach ($relative in $files) {
        $from = Join-Path $source ('installer\' + ($relative -replace '^installer\\', ''))
        if ($relative -like 'voice\*') { $from = Join-Path $source ('installer\' + $relative) }
        Assert-Ordinary $from
        Assert-PathSafe $from $source
        $to = Join-Path $root $relative
        Assert-PathSafe $to $root
        $exists = Test-Path -LiteralPath $to -PathType Leaf
        if ($exists) { Assert-Ordinary $to }
        if ($exists) { $saved = Join-Path $backupDir $relative; New-Item -ItemType Directory -Force (Split-Path $saved -Parent) | Out-Null; Copy-Item -LiteralPath $to -Destination $saved }
        $entry = @{ path=$relative; existed=$exists }
        $state.files += $entry
    }
    foreach ($default in $defaults) {
        $to = Join-Path $root $default.Dst
        Assert-PathSafe $to $root
        if (-not (Test-Path -LiteralPath $to -PathType Leaf)) { $state.files += @{ path=$default.Dst; existed=$false } }
    }
    if ($configured) {
        foreach ($choice in $pairs) {
            $relative = "config\voice-references\$choice-streaming.wav"
            $path = Join-Path $root $relative
            Assert-PathSafe $path $root
            $exists = Test-Path -LiteralPath $path -PathType Leaf
            if ($exists) {
                $saved = Join-Path $backupDir $relative
                New-Item -ItemType Directory -Force (Split-Path $saved -Parent) | Out-Null
                Copy-Item -LiteralPath $path -Destination $saved
            }
            $state.files += @{ path=$relative; existed=$exists }
        }
        foreach ($name in @('de_DE-kerstin-low','de_DE-thorsten-medium')) {
            foreach ($extension in @('.onnx','.onnx.json')) {
                $relative = "models\tts\$name$extension"
                Assert-PathSafe (Join-Path $root $relative) $root
                if (-not (Test-Path -LiteralPath (Join-Path $root $relative) -PathType Leaf)) {
                    $state.files += @{ path=$relative; existed=$false }
                }
            }
        }
    }
    Write-Result $state
    if ($state.wasRunning) { Stop-OwnVoice }
    foreach ($relative in $files) {
        $from = Join-Path $source ('installer\' + ($relative -replace '^installer\\', ''))
        if ($relative -like 'voice\*') { $from = Join-Path $source ('installer\' + $relative) }
        $to = Join-Path $root $relative
        Assert-PathSafe $to $root
        New-Item -ItemType Directory -Force (Split-Path $to -Parent) | Out-Null
        Copy-Item -LiteralPath $from -Destination $to -Force
    }
    foreach ($default in $defaults) {
        $to = Join-Path $root $default.Dst
        Assert-PathSafe $to $root
        if (Should-CopyDefault $default) { New-Item -ItemType Directory -Force (Split-Path $to -Parent) | Out-Null; Copy-Item -LiteralPath (Join-Path $source $default.Src) -Destination $to }
    }
    $state.windowsChanged = $true
    if (-not $configured) { $state.status='runtimeNotConfigured'; Write-Result $state; return }
    if ($state.wsl) {
        $python = Join-Path $root 'voice\.venv\Scripts\python.exe'
        if (-not (Test-Path -LiteralPath $python -PathType Leaf)) { throw 'Voice-Python fehlt.' }
        $prepared = Invoke-NativeCaptured $python @((Join-Path $root 'voice\prepare_voice_pairs.py'), $root, (Join-Path $source 'installer'))
        if ($prepared.ExitCode -ne 0) { throw "Stimmreferenzen konnten nicht vorbereitet werden (Exit $($prepared.ExitCode)): $(($prepared.Lines | Select-Object -Last 8) -join ' ')" }
        $state.wslAttempted = $true
        Write-Result $state
        Invoke-WslVoice 'Apply' $state
        $state.wslChanged = $true
    }
    if ($state.wasRunning) { Start-OwnVoice $state.voice }
    $state.memoryAttempted = $true
    Write-Result $state
    Invoke-MemoryUpgrade 'Apply'
    $state.status = 'applied'
    Write-Result $state
} catch {
    $reason = $_.Exception.Message
    try { Restore $state } catch { throw "Voice-Update fehlgeschlagen ($reason); Rollback nicht bestätigt: $($_.Exception.Message)" }
    throw "Voice-Update fehlgeschlagen; vorheriger Stand wiederhergestellt: $reason"
}
