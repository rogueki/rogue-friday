"""Load a cloud API key: per-user DPAPI file on Windows, private service-owned file on Linux."""

import os
import stat
import subprocess


def load_secret(secret_file: str, *, linux_file: str, label: str) -> str:
    if os.name == "posix":
        # No arbitrary path references: the installer owns this directory and
        # never places the credential under a release or web root.
        if secret_file != linux_file:
            raise RuntimeError(f"Ungueltiger {label}-Schluesselpfad")
        config_dir = os.stat(os.path.dirname(os.path.dirname(linux_file)), follow_symlinks=False)
        if (not stat.S_ISDIR(config_dir.st_mode) or config_dir.st_mode & 0o022
                or config_dir.st_uid not in (0, os.geteuid())):
            raise RuntimeError(f"{label}-Konfigurationsverzeichnis hat unsichere Rechte")
        parent = os.stat(os.path.dirname(linux_file), follow_symlinks=False)
        if not stat.S_ISDIR(parent.st_mode) or parent.st_mode & 0o077 or parent.st_uid not in (0, os.geteuid()):
            raise RuntimeError(f"{label}-Secret-Verzeichnis hat unsichere Rechte")
        descriptor = os.open(secret_file, os.O_RDONLY | os.O_NOFOLLOW | getattr(os, "O_CLOEXEC", 0))
        try:
            info = os.fstat(descriptor)
            if (not stat.S_ISREG(info.st_mode) or info.st_mode & 0o077
                    or info.st_uid not in (0, os.geteuid()) or info.st_size > 4096):
                raise RuntimeError(f"{label}-Schluesseldatei hat unsichere Rechte")
            with os.fdopen(descriptor, "rb", closefd=False) as source:
                key = source.read(4097).decode("ascii").strip()
            if not key or len(key) > 4096 or "\n" in key or "\r" in key:
                raise RuntimeError(f"{label}-Schluesseldatei ist ungueltig")
            return key
        finally:
            os.close(descriptor)
    if os.name != "nt" or not os.path.isfile(secret_file):
        raise RuntimeError(f"{label}-Schluessel fuer diesen Windows-Benutzer fehlt")
    script = ("$s=ConvertTo-SecureString (Get-Content -LiteralPath $env:FRIDAY_SECRET_FILE -Raw);"
              "$p=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($s);"
              "try {[Console]::Out.Write([Runtime.InteropServices.Marshal]::PtrToStringBSTR($p))} "
              "finally {[Runtime.InteropServices.Marshal]::ZeroFreeBSTR($p)}")
    result = subprocess.run(["powershell.exe", "-NoProfile", "-NonInteractive", "-Command", script],
                            env={**os.environ, "FRIDAY_SECRET_FILE": secret_file},
                            capture_output=True, text=True, timeout=15, check=False)
    if result.returncode or not result.stdout.strip():
        raise RuntimeError(f"{label}-Schluessel konnte nicht fuer diesen Windows-Benutzer gelesen werden")
    return result.stdout.strip()
