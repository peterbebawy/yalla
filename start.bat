@echo off
cd /d "%~dp0"
if not exist .venv python -m venv .venv
call .venv\Scripts\activate.bat
python -m pip install -r requirements.txt
if errorlevel 1 goto fail
echo Open http://127.0.0.1:8080 in your browser.
python server.py
goto end
:fail
echo Installation failed. Check your Python installation and internet connection.
:end
pause
