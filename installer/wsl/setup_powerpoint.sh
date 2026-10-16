#!/bin/bash
# Install the small Python prerequisite for Hermes' bundled PowerPoint skill.
# Rendering stays optional because LibreOffice is a large system package.
set -euo pipefail
export PATH="$HOME/.local/bin:/usr/local/bin:/usr/bin:/bin:$PATH"

if command -v python >/dev/null 2>&1; then
    if python -c 'import pptx' >/dev/null 2>&1; then
        echo 'FRIDAY_POWERPOINT_READY existing Python imports python-pptx'
        exit 0
    else
        echo 'FRIDAY_POWERPOINT_SETUP existing Python lacks python-pptx; installing isolated runtime' >&2
    fi
fi

VENV="$HOME/.local/share/friday/powerpoint-venv"
mkdir -p "$(dirname "$VENV")" "$HOME/.local/bin"
if [ ! -x "$VENV/bin/python" ]; then
    python3 -m venv "$VENV"
fi
if ! "$VENV/bin/python" -c 'import pptx' >/dev/null 2>&1; then
    timeout 180 "$VENV/bin/python" -m pip install --disable-pip-version-check --quiet 'python-pptx>=1.0,<2'
fi
"$VENV/bin/python" -c 'import pptx'

# Hermes' built-in instructions call `python scripts/pptx_*.py`. A symlink to
# a venv interpreter loses its venv prefix, so use a tiny launcher instead.
# Respect an existing user Python rather than silently replacing it.
LAUNCHER="$HOME/.local/bin/python"
if [ ! -e "$LAUNCHER" ] && [ ! -L "$LAUNCHER" ]; then
    cat > "$LAUNCHER" <<'PYTHON_LAUNCHER'
#!/bin/sh
exec "$HOME/.local/share/friday/powerpoint-venv/bin/python" "$@"
PYTHON_LAUNCHER
    chmod 755 "$LAUNCHER"
fi
if python -c 'import pptx' >/dev/null 2>&1; then
    echo 'FRIDAY_POWERPOINT_READY python-pptx available to Hermes terminal'
else
    echo "FRIDAY_POWERPOINT_UNVERIFIED use $VENV/bin/python; existing python lacks python-pptx" >&2
fi
