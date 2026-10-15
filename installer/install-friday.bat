@echo off
setlocal
chcp 65001 >nul
title F.R.I.D.A.Y. - Installation
REM ===============================================================
REM  F.R.I.D.A.Y. - Komplettinstallation. Einfach per Doppelklick starten.
REM  Administratorrechte werden automatisch angefragt.
REM  Kann jederzeit erneut gestartet werden (macht dort weiter).
REM ===============================================================
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0install-friday.ps1"
