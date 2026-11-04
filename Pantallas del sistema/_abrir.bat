@echo off
rem Ayudante comun: arranca la plataforma de reciclaje (puerto 3500) si no esta en marcha y abre una direccion.
rem   %1 = direccion completa (http://admin.reciclar.localhost:3500/)
chcp 65001 >nul
setlocal
set "SISTEMA=%~dp0.."
set "DIRECCION=%~1"

powershell -NoProfile -Command "if (Get-NetTCPConnection -LocalPort 3500 -State Listen -ErrorAction SilentlyContinue) { exit 0 } else { exit 1 }"
if not errorlevel 1 goto abrir

where node >nul 2>nul
if errorlevel 1 (
  echo No se encuentra Node.js en este ordenador.
  echo Instalalo desde https://nodejs.org ^(version 24 o posterior^) y vuelve a intentarlo.
  pause
  exit /b 1
)
if not exist "%SISTEMA%\data-demo" (
  echo Creando los datos de ejemplo...
  pushd "%SISTEMA%"
  node --disable-warning=ExperimentalWarning src/cli/demo.mjs
  popd
)
echo Arrancando la plataforma...
start "Plataforma reciclaje - no cierres esta ventana" /min /d "%SISTEMA%" cmd /k node --disable-warning=ExperimentalWarning --env-file-if-exists=.env.demo src/index.mjs
powershell -NoProfile -Command "$n = 0; while (-not (Get-NetTCPConnection -LocalPort 3500 -State Listen -ErrorAction SilentlyContinue) -and $n -lt 60) { Start-Sleep -Milliseconds 500; $n++ }"

:abrir
start "" "%DIRECCION%"
exit /b 0
