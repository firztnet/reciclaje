@echo off
chcp 65001 >nul
rem El panel donde Jose cambia su propia web: telefonos, fotos, zonas, opiniones y trabajos.
echo Titular (demo): jose@firztnet.test  /  Demo-2027-panel
call "%~dp0_abrir.bat" "http://elchatarrerodemadrid.reciclar.localhost:3500/panel/"
timeout /t 5 >nul
