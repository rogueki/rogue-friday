#!/usr/bin/env bash
set -euo pipefail

mode=${1:-}
run_id=${2:-}
[[ "$mode" == Apply || "$mode" == Rollback ]] || { echo 'Invalid mode' >&2; exit 2; }
[[ "$run_id" =~ ^[0-9a-f]{32}$ ]] || { echo 'Invalid run ID' >&2; exit 2; }
tts_root="$HOME/friday-tts"
unit="$HOME/.config/systemd/user/friday-tts.service"
backup="$tts_root/backups/$run_id"
safe_path() {
  local current="$1"
  while [[ "$current" != / ]]; do
    [[ ! -L "$current" ]] || { echo "Linked TTS update path: $current" >&2; return 2; }
    current=$(dirname "$current")
  done
}
health_ready() {
  local port
  port=$(sed -n 's/.* --port \([0-9][0-9]*\).*/\1/p' "$unit" | head -n 1)
  [[ "$port" =~ ^[0-9]+$ ]] || return 1
  curl -fsS --max-time 2 "http://127.0.0.1:$port/health" 2>/dev/null |
    python3 -c 'import json,sys; s=json.load(sys.stdin); sys.exit(0 if s.get("ok") is True and s.get("ready") is True else 1)' 2>/dev/null
}

restore() {
  [[ -d "$backup" ]] || { echo 'TTS rollback backup missing' >&2; return 1; }
  for target in "$backup" "$tts_root" "$unit" "$tts_root/server.py" "$tts_root/voices" \
                "$tts_root/voices/friday-female.wav" "$tts_root/voices/friday-female.txt" \
                "$tts_root/voices/classic.wav" "$tts_root/voices/classic.txt" \
                "$tts_root/voices/custom.wav" "$tts_root/voices/custom.txt"; do safe_path "$target"; done
  for file in server.py voices/friday-female.wav voices/friday-female.txt voices/classic.wav voices/classic.txt \
              voices/custom.wav voices/custom.txt; do
    if [[ -f "$backup/$file" ]]; then
      mkdir -p "$(dirname "$tts_root/$file")"
      cp -p "$backup/$file" "$tts_root/$file"
    else
      rm -f -- "$tts_root/$file"
    fi
  done
  if [[ -f "$backup/friday-tts.service" ]]; then cp -p "$backup/friday-tts.service" "$unit"; fi
  systemctl --user daemon-reload
  systemctl --user restart friday-tts.service
  for _ in {1..90}; do
    if systemctl --user is-active --quiet friday-tts.service && health_ready; then echo 'rolledBack'; return 0; fi
    sleep 2
  done
  echo 'Old TTS service did not recover' >&2
  return 1
}

if [[ "$mode" == Rollback ]]; then restore; exit 0; fi
[[ $# -eq 7 || $# -eq 9 ]] || { echo 'Expected pinned server, two reference pairs and an optional own pair' >&2; exit 2; }
with_custom=false
if [[ $# -eq 9 ]]; then with_custom=true; fi
[[ -f "$tts_root/server.py" && -f "$unit" ]] || { echo 'Installed TTS service missing' >&2; exit 2; }
for target in "$tts_root" "$tts_root/server.py" "$tts_root/voices" "$tts_root/backups" "$backup" "$unit" \
              "$tts_root/voices/friday-female.wav" "$tts_root/voices/friday-female.txt" \
              "$tts_root/voices/classic.wav" "$tts_root/voices/classic.txt" \
              "$tts_root/voices/custom.wav" "$tts_root/voices/custom.txt"; do
  safe_path "$target"
done
for source in "${@:3}"; do [[ -f "$source" ]] || { echo 'Source missing' >&2; exit 2; }; safe_path "$source"; done
mkdir -p "$backup/voices" "$tts_root/voices"
for file in server.py voices/friday-female.wav voices/friday-female.txt voices/classic.wav voices/classic.txt \
            voices/custom.wav voices/custom.txt; do
  if [[ -f "$tts_root/$file" ]]; then mkdir -p "$(dirname "$backup/$file")"; cp -p "$tts_root/$file" "$backup/$file"; fi
done
cp -p "$unit" "$backup/friday-tts.service"
trap 'trap - ERR; restore || { echo "TTS rollback failed" >&2; exit 1; }' ERR
cp "$3" "$tts_root/server.py"
cp "$4" "$tts_root/voices/friday-female.wav"
cp "$5" "$tts_root/voices/friday-female.txt"
cp "$6" "$tts_root/voices/classic.wav"
cp "$7" "$tts_root/voices/classic.txt"
chmod 600 "$tts_root/voices/friday-female.wav" "$tts_root/voices/friday-female.txt" \
          "$tts_root/voices/classic.wav" "$tts_root/voices/classic.txt"
if [[ "$with_custom" == true ]]; then
  cp "$8" "$tts_root/voices/custom.wav"
  cp "$9" "$tts_root/voices/custom.txt"
  chmod 600 "$tts_root/voices/custom.wav" "$tts_root/voices/custom.txt"
fi
expected='["classic", "friday-female"]'
if [[ "$with_custom" == true ]]; then expected='["classic", "custom", "friday-female"]'; fi
if ! grep -Fq -- "--voice-dir $tts_root/voices" "$unit"; then
  grep -Fq ' --port ' "$unit" || { echo 'Unrecognized TTS service command' >&2; exit 2; }
  sed -i "s| --port | --voice-dir $tts_root/voices --port |" "$unit"
fi
systemctl --user daemon-reload
systemctl --user restart friday-tts.service
port=$(sed -n 's/.* --port \([0-9][0-9]*\).*/\1/p' "$unit" | head -n 1)
[[ "$port" =~ ^[0-9]+$ ]] || { echo 'TTS port missing' >&2; exit 2; }
for _ in {1..90}; do
  if curl -fsS --max-time 2 "http://127.0.0.1:$port/health" 2>/dev/null | python3 -c 'import json,sys; s=json.load(sys.stdin); sys.exit(0 if set(json.loads(sys.argv[1])) <= set(s.get("voices",[])) else 1)' "$expected" 2>/dev/null; then
    trap - ERR
    echo 'applied'
    exit 0
  fi
  sleep 2
done
echo 'TTS voice pairs did not become ready' >&2
trap - ERR
restore || { echo 'TTS rollback failed' >&2; exit 1; }
exit 1
