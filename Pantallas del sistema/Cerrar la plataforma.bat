@echo off
chcp 65001 >nul
rem Para la plataforma de reciclaje (el servidor que escucha en el puerto 3500).
powershell -NoProfile -Command "$c = Get-NetTCPConnection -LocalPort 3500 -State Listen -ErrorAction SilentlyContinue; if (-not $c) { Write-Host 'No estaba en marcha.'; exit 0 }; $c | ForEach-Object { $p = Get-Process -Id $_.OwningProcess -ErrorAction SilentlyContinue; if ($p -and $p.ProcessName -eq 'node') { Stop-Process -Id $p.Id -Force; Write-Host 'Parado.' } else { Write-Host 'El puerto 3500 lo usa otro programa; no se ha tocado.' } }"
timeout /t 4 >nul
