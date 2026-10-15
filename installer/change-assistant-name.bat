@echo off
setlocal
chcp 65001 >nul
title F.R.I.D.A.Y. - Name und Wake Word aendern
REM ===============================================================
REM  Aendert den Namen des Assistenten (Standard: Friday) und/oder sein Wake Word (frei waehlbares Wort oder
REM  Satz, Standard "Hey <Name>"). Fragt beides ab und wiederholt danach Persoenlichkeit, Sprachkonfiguration,
REM  Stimmaufnahme und Sprachdienst. Administratorrechte werden automatisch angefragt.
REM ===============================================================
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0install-friday.ps1" -ChangeName
