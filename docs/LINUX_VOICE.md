# Native Linux voice beta

The native Ubuntu/Debian installer supports a headless ElevenLabs voice service with browser microphone and speaker audio. Its HTTP and WebSocket listeners bind to `127.0.0.1`. The dashboard proxies browser audio to the private Python service; the ElevenLabs key remains in `/etc/friday/secrets/elevenlabs.key` and is never sent to the browser. Voice requests can incur ElevenLabs charges, but installation and health checks make no ElevenLabs request.

Install from a local checkout with a matching `friday-skills` checkout:

```bash
sudo bash installer/install-friday-linux.sh --skills-source /absolute/path/friday-skills --voice-mode elevenlabs --elevenlabs-voice-id YOUR_OWN_VOICE_ID --key-prompt
```

`--dry-run` lists host prerequisites without changes. Python needs the distribution's `python3-venv` package. Once the owner profile, wake model and Hermes key exist, the installer creates `/var/lib/friday/voice/.venv`, downloads CPU wake/speaker/VAD assets and stores `pip freeze` in `/var/lib/friday/voice/pip-freeze.txt`. It writes `/etc/systemd/system/friday-voice.service`; the service starts and the dashboard voice adapter becomes live only when the private readiness check passes. If it reports `VOICE_PENDING`, the dashboard remains available and the voice adapter remains in mock mode. Rerun the installer after completing the missing prerequisites; it reuses a valid existing Voice ID and key.

## What a fresh server still needs

The browser audio transport does not yet collect the many owner enrollment recordings needed to train the ECAPA speaker profile and personal wake word. For this beta, copy **your own** existing enrollment artifacts from a Friday Windows installation, with the same wake phrase as `/etc/friday/voice.json`:

| Existing artifact | Native Linux destination |
| --- | --- |
| `voice/profiles/owner/embeddings/owner_ecapa.npy` | `/var/lib/friday/voice/profiles/owner/embeddings/owner_ecapa.npy` |
| `models/openwakeword/personal_wake.npz` | `/var/lib/friday/models/openwakeword/personal_wake.npz` |
| `models/openwakeword/personal_wake.json` | `/var/lib/friday/models/openwakeword/personal_wake.json` |

Create the destination directories as `friday` with mode `0700`, copy only these artifacts, assign owner `friday:friday`, and restrict files to `0600`. Do not publish recordings or biometrics. The installer checks that the wake metadata phrase matches the configured phrase. A fresh browser-only enrollment flow remains unfinished; without an existing profile and wake model the service deliberately stays off.

The native Linux foundation starts the Hermes **dashboard**, but does not yet bootstrap the separate Hermes API server. Run an authorized Hermes API server on the configured loopback port (default `43693`), confirm `GET /health` returns 200, and place its matching API key at `/etc/friday/secrets/hermes-api.key` owned by `friday:friday`, mode `0600`. The voice service will not start without it. Configure the provider account inside Hermes separately.

For a remote VPS, keep these services on loopback and use an SSH tunnel such as `ssh -L 3100:127.0.0.1:3100 user@server`; open `http://127.0.0.1:3100` in the local browser. Browser microphone access requires a secure context. Do not publish the raw voice HTTP/WebSocket ports. Set up the dashboard owner account before speaking. The voice bridge requires that owner session.

Check status with `systemctl status friday-voice.service`, `journalctl -u friday-voice.service -n 50 --no-pager`, and `curl http://127.0.0.1:43694/`. A healthy standby response has `state: waiting_audio` (or briefly `listening`) and `audio_transport: browser`; `listening` resumes when the owner browser connects. To validate prerequisites without starting the voice service, run as `friday`:

```bash
sudo -u friday python3 /opt/friday/current/installer/linux/prepare_voice.py --check-ready
```

The installer keeps the previous release symlink and private configuration until dashboard and voice health checks pass. A failed update restores them and restarts the prior services. A full fresh native Linux install with enrollment and a Hermes API server has not yet been exercised on a VPS. Native Linux **local GPU voice** is still configuration only; the browser voice transport currently requires ElevenLabs and there is no native GPU TTS service.
