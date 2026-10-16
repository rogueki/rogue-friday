# Schnelle lokale Friday-Stimme

Friday kann Qwen3-TTS 0.6B als dauerhaft geladenen Dienst in seiner eigenen WSL-Distribution betreiben. Der Dienst klont eine lokal bereitgestellte Stimmreferenz, erzeugt PCM bei 24 kHz und beginnt die Ausgabe, sobald der erste Block vorliegt. `friday_voice.py` rechnet die Bloecke auf die Abtastrate des gewaehlten Ausgabegeraets um und fuegt am Ende 0,55 Sekunden Stille hinzu, damit Bluetooth-Kopfhoerer den letzten Laut nicht abschneiden.

Die Referenz muss eine lokale WAV-Datei mit einem passenden Wortlaut in einer UTF-8-Textdatei sein. Beide bleiben ausserhalb des Git-Repositories. Das Setup erfolgt in `Friday-Ubuntu`:

```bash
bash /mnt/d/Kali/Friday/installer/fast_tts/install_wsl.sh \
  /mnt/d/Kali/Friday/config/voice-references/female-reference.wav \
  /mnt/d/Kali/Friday/config/voice-references/female-reference.txt
```

Danach `http://127.0.0.1:43795/health` pruefen. In `config/voice.json` `tts_backend` auf `streaming_qwen` und `tts_url` auf `http://127.0.0.1:43795/tts/stream` setzen, dann den Friday-Sprachdienst neu starten. Die bisherigen `tts_qwen_*`-Felder werden vom Streaming-Pfad nicht verwendet. Der Piper-Pfad bleibt als Ausfallreserve erhalten.

Die Erstinitialisierung laedt die Modelle und erfasst CUDA-Graphs; die Gesundheitsadresse antwortet erst danach. Der Dienst laeuft nur auf `127.0.0.1`. Die gemessene Zeit bis zum ersten Audioblock auf der RTX 4080 Laptop mit vorgewarmtem Modell und Gesa-Tess-Referenz lag fuer mehrere deutsche Saetze bei 0,50 bis 0,77 Sekunden. Die gesamte Antwortzeit umfasst zusaetzlich Wake-Erkennung, Transkription, Texterzeugung und Audioausgabe.

Die bisherige llama.cpp-Stimme wird bei einer neuen Installation noch eingerichtet. Der dauerhafte Dienst wird momentan ueber das separate Setup installiert; seine vollstaendige Einbindung in den interaktiven Installer ist noch offen.
