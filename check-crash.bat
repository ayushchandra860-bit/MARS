@echo off
cd /d C:\Users\ayush\Documents\MARS
set ELECTRON_ENABLE_LOGGING=1
set ELECTRON_ENABLE_STACK_DUMPING=1
npx electron . > C:\tmp\mars-crash.log 2>&1
