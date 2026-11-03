# Explicit one-time native migration recipe. The normal installer is unchanged.
!include "$%BRICKS_NATIVE_LAYOUT%\native-registry.nsh"
!include /CHARSET=UTF8 "${PROJECT_DIR}\scripts\desktop\installer-options.nsh"

!ifndef BUILD_UNINSTALLER
  !macro customInit
    # initMultiUser has resolved /D and the all-users installation. Pin migration
    # to that existing protected registration before NSIS uninstalls old files.
    SetRegView 64
    ReadRegStr $0 HKLM "${BRICKS_NATIVE_REGISTRY}" "InstallRoot"
    ${If} ${FileExists} "$0\bricks-bootstrap.exe"
      MessageBox MB_OK|MB_ICONSTOP "The native launcher is already installed. Use its signed component updates."
      Abort
    ${EndIf}
    ReadRegStr $0 HKLM "${BRICKS_LEGACY_REGISTRY}" "InstallLocation"
    ${If} $0 == ""
    ${OrIf} $0 != $INSTDIR
      MessageBox MB_OK|MB_ICONSTOP "Migration requires the existing all-users installation path."
      Abort
    ${EndIf}
    InitPluginsDir
    SetOutPath "$PLUGINSDIR"
    File /oname=bricks-bootstrap.exe "$%BRICKS_NATIVE_LAYOUT%\native\bricks-bootstrap.exe"
    File /oname=seed-manifest.json "$%BRICKS_NATIVE_LAYOUT%\installer-seed.json"
    ExecWait '"$PLUGINSDIR\bricks-bootstrap.exe" installer-prepare' $0
    ${If} $0 != 0
      MessageBox MB_OK|MB_ICONSTOP "The protected working-version baseline could not be prepared. No migration files were replaced."
      Abort
    ${EndIf}
  !macroend

  !macro customInstall
    # Silent install must not depend on earlier UI/plugin calls to provision the
    # elevated NSIS restricted plugin directory.
    InitPluginsDir
    # Keep embedded binaries in the elevated installer's private plugin directory.
    # Never execute a freshly extracted file from a possibly writable destination.
    SetOutPath "$PLUGINSDIR"
    File /oname=bricks-bootstrap.exe "$%BRICKS_NATIVE_LAYOUT%\native\bricks-bootstrap.exe"
    File /oname=seed-manifest.json "$%BRICKS_NATIVE_LAYOUT%\installer-seed.json"
    SetOutPath "$PLUGINSDIR\native-seed"
    File /r "$%BRICKS_NATIVE_LAYOUT%\native\*.*"
    ExecWait '"$PLUGINSDIR\bricks-bootstrap.exe" installer-register "$INSTDIR\native"' $0
    ${If} $0 != 0
      MessageBox MB_OK|MB_ICONSTOP "Native migration could not verify and protect this installation. Inspect the installation before retrying."
      Abort
    ${EndIf}
    # Existing shortcut paths/arguments are preserved. installer-register replaces
    # the verified legacy app entry with the identical native root shim. Legacy
    # rollback uses the protected pre-overwrite baseline and fixed restore helper.
    SetOutPath "$INSTDIR"
  !macroend
!endif

!macro customUnInstall
  # A normal uninstall may remove its own registration. Update payloads never
  # invoke NSIS/uninstall, and this migration installer refuses an existing root.
  SetRegView 64
  ReadRegStr $0 HKLM "${BRICKS_NATIVE_REGISTRY}" "InstallRoot"
  ${If} $0 == "$INSTDIR\native"
    DeleteRegKey HKLM "${BRICKS_NATIVE_REGISTRY}"
  ${EndIf}
!macroend
