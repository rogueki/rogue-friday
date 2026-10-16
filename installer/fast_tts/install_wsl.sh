#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 2 ]]; then
  echo "Usage: install_wsl.sh REFERENCE_WAV REFERENCE_TRANSCRIPT_FILE" >&2
  exit 2
fi

reference=$(realpath -- "$1")
transcript=$(realpath -- "$2")
[[ -f "$reference" && -f "$transcript" ]] || { echo "Voice reference or transcript missing" >&2; exit 2; }

root="$HOME/friday-tts"
mkdir -p "$root/hf"
cp "$(dirname "$0")/server.py" "$root/server.py"

if [[ ! -x "$root/.venv-fast/bin/python" ]]; then
  python3 -m venv "$root/.venv-fast"
  "$root/.venv-fast/bin/python" -m pip install --upgrade pip
  "$root/.venv-fast/bin/python" -m pip install torch==2.11.0 torchaudio==2.11.0 --index-url https://download.pytorch.org/whl/cu128
  "$root/.venv-fast/bin/python" -m pip install faster-qwen3-tts==0.5.3 qwen-tts-hf==0.1.1.post1 transformers==5.15.1
fi

unit_dir="$HOME/.config/systemd/user"
mkdir -p "$unit_dir"
cat > "$unit_dir/friday-tts.service" <<EOF
[Unit]
Description=F.R.I.D.A.Y. persistent local Qwen3 TTS
After=network-online.target

[Service]
Type=simple
ExecStart=$root/.venv-fast/bin/python $root/server.py --reference $reference --reference-text-file $transcript --port 43795 --hf-home $root/hf
Restart=on-failure
RestartSec=5

[Install]
WantedBy=default.target
EOF

systemctl --user daemon-reload
systemctl --user enable friday-tts.service
systemctl --user restart friday-tts.service
echo "Friday TTS service installed; wait for http://127.0.0.1:43795/health before selecting streaming_qwen."
