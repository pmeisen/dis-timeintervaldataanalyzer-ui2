@echo off

call %~dp0..\_control\set-env.bat

cd %~dp0
call ant stopDevEnv

cd %~dp0..\dis-timeintervaldataanalyzer\
call ant install

cd %~dp0
call ant startDevEnv

EXIT