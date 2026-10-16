# Optionaler CUDA-Fix für ältere Pascal-GPUs (sm_61)

Der lokale Archivordner `JARVIS_TTS-GPU-Fix_sm61/qwentts-gpu-fix-sm61` wurde für eine GTX 1060 gebaut. Er ist **kein Bestandteil der normalen F.R.I.D.A.Y.-Installation** und wird auf RTX-Systemen nicht verwendet. Auf der getesteten RTX 4080 lief Qwen3-TTS bereits auf der GPU; der hörbare Fehler lag bei der 24-kHz-Ausgabe an 44,1-kHz-Bluetooth-Kopfhörer und beim fehlenden Audio-Auslauf. Beides ist im normalen Sprachpfad behoben.

## Wann diese Option relevant ist

Nur wenn ein Pascal-Gerät mit Compute Capability 6.1 vorhanden ist, die Standard-Sprachausgabe nachweislich auf der CPU rechnet und die passenden CUDA-Kernels im verwendeten TTS-Build fehlen. Erst den aktiven Prozess, das GPU-Backend und die Synthesezeit messen. Eine hohe CPU-Last allein beweist noch keinen GPU-Fehler.

```powershell
nvidia-smi --query-gpu=name,compute_cap,memory.used,memory.total --format=csv
```

Der lokale Archiv-Fix nutzte [qwentts.cpp](https://github.com/ServeurpersoCom/qwentts.cpp) in einer zum Python-Binding 0.5.0 passenden Revision `6fae9291`, gebaut mit `GGML_CUDA=ON`, `CMAKE_CUDA_ARCHITECTURES=61-real` und `QWEN_SHARED=ON`. Das Archiv enthält eigene CUDA-DLLs, einen Streaming-Server und eine Anleitung. Seine Skripte enthalten alte `C:\Jarvis`- und Rechnerpfade und sind **nicht direkt für eine neue F.R.I.D.A.Y.-Installation geeignet**. Die Bindings und die native Bibliothek müssen dieselbe ABI-Revision verwenden.

Für neue Systeme zuerst die [aktuelle qwentts.cpp-Bauanleitung](https://github.com/ServeurpersoCom/qwentts.cpp#build) oder den [offiziellen llama.cpp-CUDA-Build](https://github.com/ggml-org/llama.cpp/blob/master/docs/build.md#cuda) prüfen. Das Archiv ist ein reproduzierbarer Vergleichsstand für den beschriebenen Pascal-Fall, keine automatische Fallback-Installation. Vor einem Einsatz auf einem anderen PC müssen Pfade, Modellformat, Python-Umgebung und GPU-Architektur angepasst und eine Hörprobe mit gemessener GPU-Nutzung durchgeführt werden.

Die großen gerätespezifischen DLLs, CUDA-Runtime-Dateien, Modellgewichte und privaten Stimmreferenzen liegen bewusst nicht in Git. Wer genau den alten lokalen Fix benötigt, verwendet das vorhandene Archiv auf seinem eigenen Rechner oder baut die Bibliotheken aus der angegebenen Upstream-Revision. F.R.I.D.A.Y. schaltet diese Option nicht selbst ein.
