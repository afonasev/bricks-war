!include nsDialogs.nsh

!ifndef BUILD_UNINSTALLER
  !macro customFinishPage
    !define MUI_FINISHPAGE_RUN
    !define MUI_FINISHPAGE_RUN_FUNCTION FinishLaunch
    # Standard second finish-page checkbox, with a shortcut action instead of a readme.
    !define MUI_FINISHPAGE_SHOWREADME
    !define MUI_FINISHPAGE_SHOWREADME_TEXT "Create a desktop shortcut"
    !define MUI_FINISHPAGE_SHOWREADME_FUNCTION FinishShortcut
    !define MUI_PAGE_CUSTOMFUNCTION_SHOW FinishOptionsShow
    !define MUI_PAGE_CUSTOMFUNCTION_LEAVE FinishOptionsLeave
    !insertmacro MUI_PAGE_FINISH

    Function FinishLaunch
      ${If} ${isUpdated}
        StrCpy $1 "--updated"
      ${Else}
        StrCpy $1 ""
      ${EndIf}
      ${StdUtils.ExecShellAsUser} $0 "$launchLink" "open" "$1"
    FunctionEnd

    Function FinishShortcut
      ${IfNot} ${isUpdated}
      ${AndIfNot} ${isNoDesktopShortcut}
        # All-users install: shared desktop remains visible with alternate admin credentials.
        SetShellVarContext all
        !insertmacro setLinkVars
        CreateShortCut "$newDesktopLink" "$appExe" "" "$appExe" 0 "" "" "${APP_DESCRIPTION}"
        WinShell::SetLnkAUMI "$newDesktopLink" "${APP_ID}"
        System::Call 'Shell32::SHChangeNotify(i 0x8000000, i 0, i 0, i 0)'
      ${EndIf}
    FunctionEnd

    Function FinishOptionsShow
      ${If} $LANGUAGE == 1049
        ${NSD_SetText} $mui.FinishPage.ShowReadme "Создать ярлык на рабочем столе"
      ${EndIf}
      ${If} ${isUpdated}
      ${OrIf} ${isNoDesktopShortcut}
        ShowWindow $mui.FinishPage.ShowReadme ${SW_HIDE}
        ${NSD_Uncheck} $mui.FinishPage.ShowReadme
      ${EndIf}
    FunctionEnd

    Function FinishOptionsLeave
      ${IfNot} ${isUpdated}
        ${NSD_GetState} $mui.FinishPage.ShowReadme $0
        ${If} $0 == ${BST_UNCHECKED}
          WinShell::UninstShortcut "$newDesktopLink"
          Delete "$newDesktopLink"
          System::Call 'Shell32::SHChangeNotify(i 0x8000000, i 0, i 0, i 0)'
        ${EndIf}
      ${EndIf}
    FunctionEnd

  !macroend
!endif
