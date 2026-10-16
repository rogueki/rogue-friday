# Schnelle lokale Friday-Stimme

Friday kann Qwen3-TTS 0.6B als dauerhaft geladenen Dienst in seiner eigenen WSL-Distribution betreiben. Der Dienst klont eine lokal bereitgestellte Stimmreferenz, erzeugt PCM bei 24 kHz und beginnt die Ausgabe, sobald der erste Block vorliegt. `friday_voice.py` rechnet den Audiostrom fortlaufend auf die Abtastrate des gewaehlten Ausgabegeraets um, puffert bei laengeren Saetzen 1,6 Sekunden vor und fuegt am Ende 0,55 Sekunden Stille hinzu, damit Bluetooth-Kopfhoerer den letzten Laut nicht abschneiden.

Bei einer Neuinstallation waehlt Schritt 12 diesen Dienst automatisch, wenn eine MP3/WAV-Stimmreferenz und mindestens 11 GB NVIDIA-VRAM vorhanden sind und der Whisper-GPU-Test gelingt. Der Installer erstellt eine 24-kHz-WAV-Kopie, transkribiert sie lokal, installiert den WSL-Dienst und wartet auf dessen Health-Check. Ohne diese Voraussetzungen bleibt die bisherige Qwen3-1.7B- oder Piper-Ausgabe verfuegbar. Beim Stimmenwechsel auf einen anderen Backend wird der persistente Dienst gestoppt.

Fuer eine manuelle Einrichtung muss die Referenz eine lokale WAV-Datei mit passendem Wortlaut in einer UTF-8-Textdatei sein. Beide bleiben ausserhalb des Git-Repositories. Das Setup erfolgt in der eigenen Friday-WSL-Distribution, hier als Beispiel mit Port 43795:

```bash
bash /mnt/d/Kali/Friday/installer/fast_tts/install_wsl.sh \
  /mnt/d/Kali/Friday/config/voice-references/female-reference.wav \
  /mnt/d/Kali/Friday/config/voice-references/female-reference.txt \
  43795
```

Danach `http://127.0.0.1:43795/health` pruefen. In `config/voice.json` `tts_backend` auf `streaming_qwen` und `tts_url` auf `http://127.0.0.1:43795/tts/stream` setzen, dann den Friday-Sprachdienst neu starten. Die bisherigen `tts_qwen_*`-Felder werden vom Streaming-Pfad nicht verwendet. Der Piper-Pfad bleibt als Ausfallreserve erhalten.

Die Erstinitialisierung laedt die Modelle und erfasst CUDA-Graphs; die Gesundheitsadresse antwortet erst danach. Der Dienst laeuft nur auf `127.0.0.1`. Die gemessene Zeit bis zum ersten Audioblock auf der RTX 4080 Laptop mit vorgewarmtem Modell und Gesa-Tess-Referenz lag fuer mehrere deutsche Saetze bei 0,50 bis 0,77 Sekunden. Die gesamte Antwortzeit umfasst zusaetzlich Wake-Erkennung, Transkription, Texterzeugung und Audioausgabe.

Der Installer verwendet den Port direkt nach dem konfigurierten Sprachdienst-Port, in der D:-Testinstallation 43795. Die manuelle Anleitung oben eignet sich fuer bestehende Installationen und Reparaturen.
