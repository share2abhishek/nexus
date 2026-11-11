; Social-Nexus custom NSIS installer steps
; Radixile Technology Solutions LLP

!macro customInstall
  ; User data always lives in the CURRENT user's AppData, even for an
  ; "all users" install (where $APPDATA would otherwise mean ProgramData)
  SetShellVarContext current
  CreateDirectory "$APPDATA\Social-Nexus"
  CreateDirectory "$APPDATA\Social-Nexus\content"

  ; Old "NEXUS Marketing" shortcuts point at the removed NEXUS.exe
  Delete "$DESKTOP\NEXUS Marketing.lnk"
  Delete "$SMPROGRAMS\NEXUS Marketing.lnk"
  RMDir /r "$SMPROGRAMS\NEXUS Marketing"
  SetShellVarContext all
  Delete "$DESKTOP\NEXUS Marketing.lnk"
  Delete "$SMPROGRAMS\NEXUS Marketing.lnk"
  RMDir /r "$SMPROGRAMS\NEXUS Marketing"
  SetShellVarContext current

  ; No firewall rule: the app only listens on 127.0.0.1 (this PC). Remove the
  ; rule older NEXUS installers added (needs admin; harmless if it fails).
  nsExec::ExecToLog 'netsh advfirewall firewall delete rule name="NEXUS Marketing"'
!macroend

!macro customUninstall
  nsExec::ExecToLog 'netsh advfirewall firewall delete rule name="NEXUS Marketing"'

  ; Updates also run the uninstaller - never touch data during an update
  ${ifNot} ${isUpdated}
    SetShellVarContext current
    ; Default answer keeps the user's posts, settings and licence
    MessageBox MB_YESNO|MB_ICONQUESTION|MB_DEFBUTTON2 "Also delete all Social-Nexus data on this PC (posts, settings, connected accounts, API keys, licence)?$\r$\n$\r$\nChoose No to keep it for a future reinstall." IDNO keepData
      RMDir /r "$APPDATA\Social-Nexus"
      ; Old NEXUS data and the backup left by the one-time data move
      RMDir /r "$APPDATA\NEXUS"
      FindFirst $0 $1 "$APPDATA\NEXUS.migrated-*"
      loopMigrated:
        StrCmp $1 "" doneMigrated
        RMDir /r "$APPDATA\$1"
        FindNext $0 $1
        Goto loopMigrated
      doneMigrated:
      FindClose $0
    keepData:
  ${endIf}
!macroend
