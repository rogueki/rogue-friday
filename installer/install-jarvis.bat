@echo off
setlocal
chcp 65001 >nul
title JARVIS - Installation
REM ===============================================================
REM  JARVIS - Komplettinstallation. Einfach per Doppelklick starten.
REM  Administratorrechte werden automatisch angefragt.
REM  Kann jederzeit erneut gestartet werden (macht dort weiter).
REM ===============================================================
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0install-jarvis.ps1"
