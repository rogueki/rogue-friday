@echo off
setlocal
chcp 65001 >nul
title F.R.I.D.A.Y. - Assistentennamen aendern
REM ===============================================================
REM  Aendert den Namen des Assistenten (Standard: Friday, Wake Word "Hey <Name>").
REM  Fragt den neuen Namen ab und wiederholt danach Persoenlichkeit, Sprachkonfiguration,
REM  Stimmaufnahme und Sprachdienst. Administratorrechte werden automatisch angefragt.
REM ===============================================================
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0install-jarvis.ps1" -ChangeName
