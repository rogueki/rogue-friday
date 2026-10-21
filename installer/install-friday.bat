@echo off
setlocal
chcp 65001 >nul
title F.R.I.D.A.Y. - Installation
REM ===============================================================
REM  F.R.I.D.A.Y. - Komplettinstallation. Einfach per Doppelklick starten.
REM  Administratorrechte werden automatisch angefragt.
REM  Kann jederzeit erneut gestartet werden (macht dort weiter).
REM ===============================================================
REM Parameter werden durchgereicht: install-friday.bat -Resume -InstallRoot "D:\..." -DistroName "...".
REM Ohne Durchreichung landete ein Resume eines eigenen Zielordners in C:\Friday (Doppelinstallation).
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0install-friday.ps1" %*
