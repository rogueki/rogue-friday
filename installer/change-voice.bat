@echo off
setlocal
chcp 65001 >nul
title F.R.I.D.A.Y. - Ausgabestimme aendern
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0install-friday.ps1" -ChangeVoice
