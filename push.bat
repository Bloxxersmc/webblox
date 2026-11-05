@echo off
cd /d "%~dp0"
git add -A
git diff --cached --quiet
if %errorlevel%==0 (
  echo Nothing to push.
  pause
  exit /b
)
git commit -m "Update %date% %time%"
git push origin main
pause
