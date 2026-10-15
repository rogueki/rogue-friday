# Startet den lokalen Qwen3-4B-Router (llama.cpp) auf 127.0.0.1:43692. Parameter: C:\Friday\config\qwen.json
$ErrorActionPreference = 'Stop'
$root = 'C:\Friday'
$cfg  = Get-Content "$root\config\qwen.json" -Raw | ConvertFrom-Json
$log  = "$root\logs\qwen-server.log"
if (Get-NetTCPConnection -LocalPort 43692 -State Listen -ErrorAction SilentlyContinue) { exit 0 }
# Einzelinstanz auch waehrend des Modellladens (Port noch zu): laeuft schon ein llama-server auf diesem Port, nichts doppelt starten.
if (Get-CimInstance Win32_Process -Filter "Name='llama-server.exe'" -ErrorAction SilentlyContinue | Where-Object { $_.CommandLine -like '*--port 43692*' }) { exit 0 }
$serverArgs = @(
    '-m', "$root\models\Qwen3-4B\Qwen3-4B-Q4_K_M.gguf",
    '--alias', 'qwen3-router',
    '--host', '127.0.0.1', '--port', '43692',
    '--ctx-size', "$($cfg.ctx_size)",
    '--n-gpu-layers', "$($cfg.gpu_layers)",
    '--parallel', '1',
    '--jinja'
)
Start-Process -FilePath "$root\llama.cpp\llama-server.exe" -ArgumentList $serverArgs -WindowStyle Hidden `
    -RedirectStandardError $log -RedirectStandardOutput "$log.out"
