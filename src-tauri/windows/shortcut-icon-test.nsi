Unicode true
!include LogicLib.nsh
!include "Win\COM.nsh"
!include "@INCLUDE@"
Name "Hermes shortcut icon contract"
OutFile "@EXE@"
RequestExecutionLevel user
SilentInstall silent
Section
 ClearErrors
 !insertmacro HermesSetShortcutIcon "@LINK@" "@ICON@"
 IfErrors failed
 ClearErrors
 !insertmacro HermesSetShortcutIcon "@MISSING@" "@ICON@"
 IfErrors passed failed
 passed:
 SetErrorLevel 0
 Quit
 failed:
 SetErrorLevel 2
SectionEnd
