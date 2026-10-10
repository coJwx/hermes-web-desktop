Unicode true
!include LogicLib.nsh
!include "maintenance.nsh"
Name "Hermes maintenance policy test"
OutFile "policy.exe"
RequestExecutionLevel user
SilentInstall silent
!macro Check VERSION SELECTED EXPECTED
 !insertmacro HermesMaintenanceAction ${VERSION} ${SELECTED} $0
 ${If} $0 != "${EXPECTED}"
   SetErrorLevel 2
   Quit
 ${EndIf}
!macroend
Section
 !insertmacro Check 0 1 "install"
 !insertmacro Check 0 0 "uninstall"
 !insertmacro Check 1 1 "install"
 !insertmacro Check 1 0 "uninstall"
 !insertmacro Check -1 1 "uninstall"
 !insertmacro Check -1 0 "install"
 SetErrorLevel 0
SectionEnd
