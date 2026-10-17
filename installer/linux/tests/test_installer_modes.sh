#!/usr/bin/env bash
set -euo pipefail
script=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd -P)/install-friday-linux.sh
root=$(dirname "$(dirname "$script")")
bash -n "$script"

output=$(bash "$script" --dry-run)
[[ "$output" == *'Dry-run: no user, files, build, provider call or systemd service changed.'* ]]
[[ "$output" == *'127.0.0.1:3100'* ]]
[[ "$output" == *'Dry-run does not invoke pnpm/Corepack'* ]]

generated=$(awk '/^  cat > "\$CONFIG\/dashboard.yaml" <<YAML$/ {p=1; next} p && /^YAML$/ {exit} p {print}' "$script")
[[ "$generated" == *'dataMode: hybrid'* ]]
[[ "$generated" == *'ownerPasswordHash: file:$CONFIG/secrets/owner.hash'* ]]
[[ "$generated" != *'dataMode: mock'* ]]
grep -Fq 'Environment=FRIDAY_INSTALL_ROOT=$CURRENT' "$script"
grep -Fq 'pnpm build:app' "$script"

if [[ -f "$root/../friday-skills-main/registry/integration_setup.json" ]]; then
  python3 "$root/installer/linux/configure_skills.py" --check-only "$root/../friday-skills-main" >/dev/null
  ROOT="$root" python3 - <<'PY'
import os
from pathlib import Path
import subprocess
import tempfile

root = Path(os.environ['ROOT'])
checkout = root.parent / 'friday-skills-main'
helper = root / 'installer/linux/configure_skills.py'
with tempfile.TemporaryDirectory() as home:
    env = {**os.environ, 'HOME': home}
    stable = '/opt/friday/current/skills/friday-skills/skills'
    for _ in range(2):
        subprocess.run(['python3', str(helper), str(checkout), stable], env=env, check=True, stdout=subprocess.DEVNULL)
    config = (Path(home) / '.hermes/config.yaml').read_text()
    assert config.count(stable) == 1
PY
fi

if bash "$script" --dry-run --dashboard-port 70000 >/dev/null 2>&1; then
  echo 'invalid port unexpectedly accepted' >&2
  exit 1
fi
if bash "$script" --dry-run --dashboard-port 3100 --hermes-port 3100 >/dev/null 2>&1; then
  echo 'overlapping ports unexpectedly accepted' >&2
  exit 1
fi
if bash "$script" --dry-run --source /does/not/exist >/dev/null 2>&1; then
  echo 'invalid source unexpectedly accepted' >&2
  exit 1
fi
echo 'installer mode checks PASS'
