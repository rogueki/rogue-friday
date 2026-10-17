#!/usr/bin/env bash
set -euo pipefail
root=$1 state=$2 config=$3 voice_port=$4 dashboard_port=$5
marker="$state/voice/enrollment/activate"
active="$state/voice/enrollment/active"
trap 'rm -f -- "$marker"' EXIT
[[ -f "$marker" && ! -L "$marker" ]] || exit 1
runuser -u friday -- env HOME="$state" HF_HOME="$state/cache/huggingface" \
  "$state/voice/.venv/bin/python" "$root/installer/linux/prepare_voice.py" --check-ready
systemctl enable friday-voice.service >/dev/null
systemctl restart friday-voice.service
ready=0
for ((attempt=0; attempt<30; attempt++)); do
  if curl -fsS --max-time 2 "http://127.0.0.1:$voice_port/" 2>/dev/null | \
      python3 -c 'import json,sys; s=json.load(sys.stdin); assert s["audio_transport"] == "browser" and s["state"] in ("waiting_audio", "listening")' 2>/dev/null; then ready=1; break; fi
  sleep 3
done
(( ready )) || exit 1
wake_phrase=$(python3 - "$config/voice.json" <<'PY'
import json,sys
print(json.load(open(sys.argv[1], encoding="utf-8"))["wake_phrase"])
PY
)
python3 "$root/installer/linux/enable_voice_adapter.py" --voice-port "$voice_port" --wake-phrase "$wake_phrase"
systemctl restart friday-dashboard.service
curl -fsS --max-time 3 --retry 10 --retry-connrefused --retry-delay 2 -o /dev/null "http://127.0.0.1:$dashboard_port/api/v1/health"
printf 'active\n' > "$active"
chown friday:friday "$active"
chmod 0600 "$active"
