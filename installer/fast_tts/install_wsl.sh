#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 3 && $# -ne 7 ]]; then
  echo "Usage: install_wsl.sh REFERENCE_WAV REFERENCE_TRANSCRIPT_FILE PORT [FRIDAY_WAV FRIDAY_TXT CLASSIC_WAV CLASSIC_TXT]" >&2
  exit 2
fi

reference=$(realpath -- "$1")
transcript=$(realpath -- "$2")
[[ -f "$reference" && -f "$transcript" ]] || { echo "Voice reference or transcript missing" >&2; exit 2; }
port="$3"
[[ "$port" =~ ^[0-9]+$ ]] && (( port >= 1024 && port <= 65535 )) || { echo "Invalid TTS port" >&2; exit 2; }

root="$HOME/friday-tts"
voice_args=""
mkdir -p "$root/hf"
chmod 700 "$root"
cp "$(dirname "$0")/server.py" "$root/server.py"
cp "$reference" "$root/reference.wav"
cp "$transcript" "$root/reference.txt"
chmod 600 "$root/reference.wav" "$root/reference.txt"
if [[ $# -eq 7 ]]; then
  voice_args=" --voice-dir $root/voices"
  mkdir -p "$root/voices"
  for choice in friday-female classic; do
    if [[ "$choice" == friday-female ]]; then audio="$4"; words="$5"; else audio="$6"; words="$7"; fi
    [[ -f "$audio" && -f "$words" && -s "$words" ]] || { echo "Voice pair unavailable: $choice" >&2; exit 2; }
    cp "$audio" "$root/voices/$choice.wav"
    cp "$words" "$root/voices/$choice.txt"
    chmod 600 "$root/voices/$choice.wav" "$root/voices/$choice.txt"
  done
fi

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
ExecStart=$root/.venv-fast/bin/python $root/server.py --reference $root/reference.wav --reference-text-file $root/reference.txt$voice_args --port $port --hf-home $root/hf
Restart=on-failure
RestartSec=5

[Install]
WantedBy=default.target
EOF

systemctl --user daemon-reload
systemctl --user enable friday-tts.service
systemctl --user restart friday-tts.service
echo "Friday TTS service installed; wait for http://127.0.0.1:$port/health before selecting streaming_qwen."
