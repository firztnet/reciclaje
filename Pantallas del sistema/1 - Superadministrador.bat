@echo off
chcp 65001 >nul
rem Tu panel: clientes, altas, pruebas, activaciones, suspensiones y la web de cada uno.
echo Superadministrador (demo): admin@firztnet.test  /  Admin-2027-demo
call "%~dp0_abrir.bat" "http://admin.reciclar.localhost:3500/"
timeout /t 5 >nul
