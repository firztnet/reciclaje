@echo off
chcp 65001 >nul
rem Para la plataforma, borra los datos de la demo y los vuelve a crear (superadministrador y Jose y Manuel).
call "%~dp0Cerrar la plataforma.bat"
pushd "%~dp0.."
node --disable-warning=ExperimentalWarning src/cli/demo.mjs
popd
echo Listo. Abre «1 - Superadministrador» para entrar.
timeout /t 6 >nul
