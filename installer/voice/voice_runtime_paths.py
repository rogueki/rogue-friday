"""Resolve Friday voice helper paths for native Linux and legacy Windows installs."""

import os
import posixpath
import re
import sys


DEFAULT_DASHBOARD_PORT = 3100


def _is_linux(platform=None):
    return (platform or sys.platform).startswith("linux")


def _path_module(platform=None):
    return posixpath if _is_linux(platform) else os.path


def _join(root, *parts, platform=None):
    return _path_module(platform).join(root, *parts)


def _absolute_env_path(name, default, platform=None):
    value = os.environ.get(name)
    if not value:
        return default
    path = _path_module(platform)
    if "\x00" in value or len(value) > 4096 or not path.isabs(value):
        return default
    return path.normpath(value)


def _linux_state_root(platform=None):
    return _absolute_env_path("FRIDAY_STATE_ROOT", "/var/lib/friday", platform)


def data_dir(root, platform=None):
    if not _is_linux(platform):
        return os.path.join(root, "dashboard", "data")
    return _absolute_env_path("FRIDAY_DATA_DIR", _join(_linux_state_root(platform), "data", platform=platform), platform)


def state_dir(root, platform=None):
    if not _is_linux(platform):
        return os.path.join(root, "run")
    return _join(_linux_state_root(platform), "run", platform=platform)


def voice_bridge_dir(root, platform=None):
    return _join(data_dir(root, platform), "voice-bridge", platform=platform)


def voice_bridge_key_path(root, platform=None):
    return _join(voice_bridge_dir(root, platform), "auth.key", platform=platform)


def onboarding_offer_path(root, platform=None):
    return _join(voice_bridge_dir(root, platform), "onboarding-offer.json", platform=platform)


def content_studio_state_path(root, platform=None):
    return _join(state_dir(root, platform), "content-studio-voice.json", platform=platform)


def _configured_linux_dashboard_port():
    env_port = os.environ.get("FRIDAY_DASHBOARD_PORT")
    if env_port is not None and re.fullmatch(r"[0-9]{1,5}", env_port):
        port = int(env_port)
        if 1 <= port <= 65535:
            return port

    config_dir = _absolute_env_path("FRIDAY_CONFIG_DIR", "/etc/friday", "linux")
    path = _join(config_dir, "dashboard.yaml", platform="linux")
    try:
        with open(path, encoding="utf-8-sig") as source:
            content = source.read(128 * 1024)
    except OSError:
        return DEFAULT_DASHBOARD_PORT

    # Read only the top-level server.port field and reject ambiguous YAML shapes.
    section = re.search(r"(?ms)^server:[ \t]*(?:#[^\n]*)?\n((?:^[ \t]+[^\n]*\n?)*)", content)
    port = re.search(r"(?m)^[ \t]+port:[ \t]*([0-9]{1,5})[ \t]*(?:\#.*)?$", section.group(1)) if section else None
    if port:
        value = int(port.group(1))
        if 1 <= value <= 65535:
            return value
    return DEFAULT_DASHBOARD_PORT


def dashboard_port(root, platform=None):
    if _is_linux(platform):
        return _configured_linux_dashboard_port()

    path = os.path.join(root, "dashboard", "config", "dashboard.yaml")
    try:
        with open(path, encoding="utf-8-sig") as source:
            content = source.read(128 * 1024)
        section = re.search(r"(?ms)^server:\s*\n((?:^[ \t]+[^\n]*\n?)*)", content)
        port = re.search(r"(?m)^\s+port:\s*(\d{2,5})\b", section.group(1)) if section else None
        if port and 1 <= int(port.group(1)) <= 65535:
            return int(port.group(1))
    except OSError:
        pass
    return DEFAULT_DASHBOARD_PORT
