# Native Linux voice beta

The native Ubuntu/Debian installer supports a headless ElevenLabs voice service with browser microphone and speaker audio. Its HTTP and WebSocket listeners bind to `127.0.0.1`. The dashboard proxies browser audio to the private Python service; the ElevenLabs key remains in `/etc/friday/secrets/elevenlabs.key` and is never sent to the browser. Voice requests can incur ElevenLabs charges, but installation and health checks make no ElevenLabs request.

Install from a local checkout with a matching `friday-skills` checkout:

```bash
sudo bash installer/install-friday-linux.sh --skills-source /absolute/path/friday-skills --voice-mode elevenlabs --elevenlabs-voice-id YOUR_OWN_VOICE_ID --key-prompt
```

`--dry-run` lists host prerequisites without changes. Python needs the distribution's `python3-venv` package. In ElevenLabs mode the installer creates `/var/lib/friday/voice/.venv`, downloads CPU wake/speaker/VAD assets and stores `pip freeze` in `/var/lib/friday/voice/pip-freeze.txt` **before** enrollment. It writes `/etc/systemd/system/friday-voice.service`; the service starts and the dashboard voice adapter becomes live only when the private readiness check passes. If it reports `VOICE_PENDING`, the dashboard stays available. Sign in as owner, open **Stimme → Browser-Stimme einrichten**, and record the guided activation phrase, short form if shown, other words and reading samples. The optional dialog can be closed at any time; the rest of the dashboard stays usable. After training, `friday-voice-activate.path` checks readiness, starts the voice service and enables its dashboard adapter. No manual file transfer or installer rerun is needed. A valid existing Voice ID and key are reused on later installs.

## Private enrollment

The browser submits one bounded 16-kHz PCM sample at a time through owner-session and CSRF-protected Control API routes. Recordings are written with private permissions under `/var/lib/friday/voice/profiles/owner/raw`, then removed after successful training; incomplete recordings expire after seven days while the dashboard runs. ECAPA speaker and personal wake models remain private on the server. The service remains off if training, model files, the Hermes API, or the voice key fail readiness. A failed activation can be retried from the same dialog without repeating the recordings. Training can take several minutes on CPU. Keep the browser on `localhost` or HTTPS so microphone access is allowed.

The installer also starts the Hermes API gateway as `friday-hermes-gateway.service` on `127.0.0.1` (default port `43693`). It generates or reuses a private key at `/etc/friday/secrets/hermes-api.key`, writes matching `API_SERVER_*` settings to `/var/lib/friday/.hermes/.env`, and checks authenticated `GET /v1/models` before continuing. Both key-bearing files are owned by `friday` with mode `0600`. Existing model/provider settings are preserved. Configure the provider account inside Hermes separately with `hermes model`; the installer does not require Kimi or make a paid model call. On a failed update it restores the previous Hermes API settings, service unit and release.

For a remote VPS, keep these services on loopback and use an SSH tunnel such as `ssh -L 3100:127.0.0.1:3100 user@server`; open `http://127.0.0.1:3100` in the local browser. Browser microphone access requires a secure context. Do not publish the raw voice HTTP/WebSocket ports. Set up the dashboard owner account before speaking. The voice bridge requires that owner session.

Check status with `systemctl status friday-voice.service`, `journalctl -u friday-voice.service -n 50 --no-pager`, and `curl http://127.0.0.1:43694/`. A healthy standby response has `state: waiting_audio` (or briefly `listening`) and `audio_transport: browser`; `listening` resumes when the owner browser connects. To validate prerequisites without starting the voice service, run as `friday`:

```bash
sudo -u friday python3 /opt/friday/current/installer/linux/prepare_voice.py --check-ready
```

The installer keeps the previous release symlink and private configuration until dashboard and voice health checks pass. A failed update restores them and restarts the prior services. A full fresh native Linux install with enrollment and the Hermes API gateway has not yet been exercised on a VPS. Native Linux **local GPU voice** is still configuration only; the browser voice transport currently requires ElevenLabs and there is no native GPU TTS service.

## Orb events from the voice path

The dashboard orb is driven by real events, not by guesses. The Python service reports a pipeline `phase` (`listening`, `transcribing`, `thinking`, `speaking`, `idle`) in the status JSON on `127.0.0.1:43694`; the Control API's voice adapter turns each change into `friday.voice.state_changed`. In browser transport the Control API's audio gateway additionally sees every PCM frame and publishes `friday.voice.audio_level` (direction `input` while the service listens, `output` for TTS, with peak and low/mid/high bands) and `friday.voice.tts_started` / `friday.voice.tts_ended`. Only numbers are published; no audio and no transcript text leave the voice service through these events. Details: `docs/MAPPING/voice.md` §0.6/0.7.
