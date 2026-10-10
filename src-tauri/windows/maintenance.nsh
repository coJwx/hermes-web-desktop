; Small policy shared by the real wizard and the compiled regression harness.
; Inputs: semver comparison (0=same, 1=upgrade, -1=downgrade), first radio selected.
!macro HermesMaintenanceAction VERSION FIRST_SELECTED OUTPUT
  StrCpy ${OUTPUT} "install"
  ${If} ${VERSION} = 0
  ${OrIf} ${VERSION} = 1
    ${If} ${FIRST_SELECTED} = 0
      StrCpy ${OUTPUT} "uninstall"
    ${EndIf}
  ${ElseIf} ${VERSION} = -1
    ${If} ${FIRST_SELECTED} = 1
      StrCpy ${OUTPUT} "uninstall"
    ${EndIf}
  ${EndIf}
!macroend

; Update only the icon field of an app-owned shortcut; preserve arguments and other metadata.
!macro HermesSetShortcutIcon SHORTCUT ICON
  Push $0
  Push $1
  Push $2
  StrCpy $2 1
  !insertmacro ComHlpr_CreateInProcInstance ${CLSID_ShellLink} ${IID_IShellLink} r0 ""
  ${If} $0 P<> 0
    ${IUnknown::QueryInterface} $0 '("${IID_IPersistFile}",.r1)'
    ${If} $1 P<> 0
      ${IPersistFile::Load} $1 '("${SHORTCUT}", ${STGM_READWRITE}).r2'
      ${If} $2 = 0
        ${IShellLink::SetIconLocation} $0 '(w "${ICON}",i 0).r2'
        ${If} $2 = 0
          ${IPersistFile::Save} $1 '("${SHORTCUT}",1).r2'
        ${EndIf}
      ${EndIf}
      ${IUnknown::Release} $1 ""
    ${EndIf}
    ${IUnknown::Release} $0 ""
  ${EndIf}
  ${If} $2 = 0
    ; Notify only this item, not the global icon cache or Explorer process.
    System::Call 'shell32::SHChangeNotify(i 0x2000,i 0x0005,w "${SHORTCUT}",p 0)'
  ${Else}
    DetailPrint "Unable to update shortcut icon: ${SHORTCUT} (HRESULT $2)"
    SetErrors
  ${EndIf}
  Pop $2
  Pop $1
  Pop $0
!macroend
