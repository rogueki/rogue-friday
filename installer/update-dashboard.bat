@echo off
setlocal
chcp 65001 >nul
title F.R.I.D.A.Y. - Command Center aktualisieren
REM ===============================================================
REM  Spielt eine neuere Version des Command Centers (Dashboard) ein: kopiert die Quellen nach C:\Friday\dashboard,
REM  baut neu (nur wenn sich etwas geaendert hat) und startet es. Konfiguration und Daten bleiben erhalten.
REM  Muss aus dem entpackten, vollstaendigen Paket (neben den Ordnern apps und packages) gestartet werden.
REM ===============================================================
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0install-friday.ps1" -UpdateDashboard
