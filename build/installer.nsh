; NEXUS Custom NSIS installer script
; This runs additional steps during NSIS install/uninstall

!macro customInstall
  ; Create data folder in AppData
  CreateDirectory "$APPDATA\NEXUS"
  CreateDirectory "$APPDATA\NEXUS\data"
  CreateDirectory "$APPDATA\NEXUS\content"

  ; Write registry entry for auto-start (optional - user can disable in app)
  ; WriteRegStr HKCU "SOFTWARE\Microsoft\Windows\CurrentVersion\Run" "NEXUS" '"$INSTDIR\NEXUS.exe" --minimized'

  ; Add firewall exception for localhost port 3000
  nsExec::ExecToLog 'netsh advfirewall firewall add rule name="NEXUS Marketing" dir=in action=allow protocol=TCP localport=3000 profile=private'
!macroend

!macro customUninstall
  ; Remove firewall rule
  nsExec::ExecToLog 'netsh advfirewall firewall delete rule name="NEXUS Marketing"'

  ; Ask if user wants to keep data
  MessageBox MB_YESNO "Do you want to keep your NEXUS data (posts, settings, database)?" IDYES keepData
    RMDir /r "$APPDATA\NEXUS"
  keepData:
!macroend
