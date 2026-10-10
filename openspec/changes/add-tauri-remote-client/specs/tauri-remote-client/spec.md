## ADDED Requirements
### Requirement: Packaged frontend
The client SHALL embed the existing frontend and SHALL NOT bundle or start a Hermes Python backend.
#### Scenario: Build
- **WHEN** a Windows desktop release is built
- **THEN** an application exe and NSIS installer are produced with embedded frontend resources.

### Requirement: Configurable remote backend
The client SHALL default to http://10.144.1.2:9119, validate HTTP(S) URLs, persist the chosen URL, and allow changes through an offline connection window and native menu.
#### Scenario: Switching servers
- **WHEN** the user connects to another valid address
- **THEN** the address is persisted and the previous bridge/cookie session is replaced.
#### Scenario: Invalid input
- **WHEN** an address includes credentials, unsupported schemes, query or fragment
- **THEN** connection is rejected with a readable error.

### Requirement: Preserve dashboard transport
The client SHALL serve bundled assets, preserve whitelisted backend bootstrap data and forward HTTP requests and text/binary WebSocket frames to the selected server.
#### Scenario: Authenticated dashboard
- **WHEN** the remote server supplies a session token or cookie login
- **THEN** API requests and WebSocket upgrades retain the existing authentication semantics.
#### Scenario: Offline backend
- **WHEN** the selected backend is unreachable
- **THEN** a readable connection error is shown and settings remain accessible.

### Requirement: Isolated bridge
The bridge SHALL listen only on loopback, authenticate local requests and reject cross-origin requests. Remote content SHALL NOT receive native configuration capabilities.
#### Scenario: Unauthorized local access
- **WHEN** an unrelated client lacks the bridge cookie or supplies another Host/Origin
- **THEN** its request is rejected before any upstream access.


### Requirement: Writable startup storage
The client SHALL check storage before creating WebViews, preserve writable standard profile paths, and fall back to executable-adjacent portable storage when standard directories are unavailable. Both windows and URL persistence SHALL use the selected storage mode. An unrecoverable startup error SHALL be visible in a native error dialog.
#### Scenario: Restricted AppData
- **WHEN** the default AppData directory is not writable but the exe directory is writable
- **THEN** the connection window starts using hermes-dashboard-data and saved URLs survive restart.
#### Scenario: No writable storage
- **WHEN** neither standard nor portable storage is available
- **THEN** startup reports both directory failures instead of silently exiting.


### Requirement: Backend-scoped restart persistence
The Windows client SHALL persist selected theme/font and valid login cookies per canonical backend URL. Changing the bridge port or reopening the app SHALL NOT reset them. Browser builds SHALL retain their existing storage behavior. Cookie plaintext SHALL NOT be written to disk; saved sessions SHALL be protected by the current Windows user and bound to the backend.
#### Scenario: Reopening a backend
- **WHEN** a user saves a Codex theme and logs in, then closes and reopens the same backend
- **THEN** the bundled frontend restores the theme before mount and HTTP/WebSocket requests use the recovered valid cookies without another login.
#### Scenario: Switching A to B to A
- **WHEN** a user switches between backend URLs
- **THEN** B does not receive A's credentials or preferences, and reconnecting A restores A's own state.
#### Scenario: Expiry and explicit logout
- **WHEN** cookies expire or the user explicitly logs out
- **THEN** those cookies are not sent after a restart; logout clears the local saved session even if remote revocation fails.
#### Scenario: Corrupted or wrong-user encrypted state
- **WHEN** a session blob cannot be decrypted or is moved into another backend's state directory
- **THEN** it is rejected with a readable recovery error, never interpreted as plaintext or sent to that backend.


### Requirement: Locale restart restoration
The desktop client SHALL restore its saved page locale before I18nProvider initializes, independently of the loopback port. Browser builds SHALL keep their existing locale storage behavior.
#### Scenario: Chinese after reopening
- **WHEN** a user selects zh, saves it and reconnects the same backend with a fresh bridge
- **THEN** hermes-locale is restored as zh alongside the theme and font.

### Requirement: Installable Windows delivery
The Windows delivery SHALL use the standard Tauri NSIS installer, create writable missing target directories, and preserve existing user data during reinstall. Delivery SHALL not retain the build workspace's Low integrity label. It SHALL not require changing system or target-directory ACLs.
#### Scenario: Fresh installation
- **WHEN** a user runs the published setup from a normal user directory and chooses a writable missing nested target with Unicode and spaces
- **THEN** the installer creates the target, installs the executable and uninstaller, and registers the installation in HKCU.
#### Scenario: Reinstall and launch
- **WHEN** the same published setup is installed again and its installed executable is launched
- **THEN** existing user data remains unchanged and the offline connection window and WebView2 start.
#### Scenario: Reproducible packaging
- **WHEN** the build workspace carries Low integrity metadata
- **THEN** the delivery step writes fresh files outside that workspace and provides an archive and checksums, without weakening directory permissions.

### Requirement: Integrated Windows titlebar
The Windows dashboard SHALL display the connection menu directly after the backend title in the same top row, without a second native menu row. It SHALL retain existing connection/reload/quit actions and standard window controls. The remote dashboard SHALL NOT receive native window capabilities.
#### Scenario: Menu and window controls
- **WHEN** a Windows dashboard is open
- **THEN** its host title, connection menu and minimize/maximize/close buttons share one row, and resizing leaves the dashboard below the titlebar.
#### Scenario: Remote isolation
- **WHEN** a proxied dashboard attempts to invoke a titlebar command
- **THEN** the native action is rejected, while the bundled local titlebar can invoke it.
#### Scenario: Close and reconnect
- **WHEN** the dashboard is closed or its backend is changed
- **THEN** closing Dashboard exits the client, while changing the backend creates a Dashboard with the correct titlebar and content.


### Requirement: Saved backend startup and desktop close
The client SHALL automatically connect a valid saved backend on startup. Missing or invalid connection settings and startup connection failures SHALL show the offline editable settings form. The form SHALL have no redundant connection menu bar and SHALL show the selected local data directory. Dashboard close and menu Quit SHALL both exit the application without showing settings again.
#### Scenario: Saved backend restart
- **WHEN** the client starts with a valid saved address
- **THEN** it opens that backend using the existing isolated bridge and saved backend-scoped state, without requiring another save/confirmation.
#### Scenario: First run or failed automatic connection
- **WHEN** the saved address is absent, corrupt, or unreachable
- **THEN** the editable connection form remains available; failures are readable and do not delete existing user state.
#### Scenario: Closing windows
- **WHEN** Dashboard is closed or menu Quit is selected
- **THEN** the whole client exits.
#### Scenario: Closing auxiliary settings
- **WHEN** the settings window is closed while a Dashboard is still open
- **THEN** only settings is hidden and the existing Dashboard remains connected.

### Requirement: Dashboard maximized-mode persistence
The client SHALL persist the Dashboard's last non-minimized maximized/normal mode independently of backend credentials. It SHALL restore that mode before showing a new Dashboard, including on automatic reconnect and backend switching. Minimize and hidden window initialization SHALL NOT reset the saved mode. No ordinary window position/size persistence is required.
#### Scenario: Maximize then restart
- **WHEN** Dashboard is maximized and the user exits through X or menu Quit
- **THEN** the next Dashboard opens maximized with its titlebar control labeled Restore.
#### Scenario: Restore then restart
- **WHEN** the user restores Dashboard to a normal window and exits
- **THEN** the next Dashboard opens in normal mode.
#### Scenario: Minimize does not erase mode
- **WHEN** a maximized Dashboard is minimized before quitting
- **THEN** its next launch restores maximized mode, not a minimized or normal window.

### Requirement: Windows Dashboard content zoom
The Windows Dashboard content WebView SHALL enable native browser-style zoom hotkeys and mousewheel zoom. The separate titlebar WebView SHALL retain its existing zoom setting. Zoom-state persistence and other platform behavior are outside this change.
#### Scenario: Content zoom
- **WHEN** the focused Dashboard content receives Ctrl-plus/equal, Ctrl-minus, Ctrl-zero or Ctrl-mousewheel
- **THEN** its native WebView zoom controls are enabled without scaling the separate titlebar.

### Requirement: Grouped desktop application menu
The client SHALL provide grouped connection, view, settings, developer and help commands under one titlebar menu. It SHALL persist auto-connect, always-on-top and optional content zoom independently of connection credentials. Developer tools SHALL open only on user action and remote content SHALL gain no native capabilities.
#### Scenario: Preferences and zoom
- **WHEN** the user changes automatic connection, pinning or zoom-memory settings
- **THEN** the saved preferences restore on reopening without changing existing connection/window/session files; disabling zoom memory leaves the current page unchanged and uses100% for the next Dashboard.
#### Scenario: Keyboard zoom followed by quit
- **WHEN** the user changes content zoom with native hotkeys/wheel and exits normally
- **THEN** zoom-memory snapshots the actual controller ratio before quitting, while the titlebar remains unscaled.
#### Scenario: Developer and help tools
- **WHEN** the user opens Developer Tools, the data directory or About from the native menu
- **THEN** the command targets the Dashboard or its selected local profile; About displays only trusted read-only metadata and rejects remote callers.

### Requirement: Dedicated multi-resolution desktop icon
Desktop builds SHALL preserve the dedicated ICO selected from bootstrap-installer and SHALL NOT overwrite it with the browser favicon. Application/titlebar/installer/uninstaller SHALL use this same multi-resolution resource.
#### Scenario: Rebuilding assets
- **WHEN** the desktop preparation/build runs
- **THEN** the source ICO and embedded desktop ICO remain byte-identical and include a256px frame, while the web favicon is unchanged.

### Requirement: Complete desktop icon sizing and explicit shortcut icon
Desktop icon assets SHALL include the48px frame and common intermediate DPI sizes regenerated from the high-resolution master, not from a small favicon. Installed shortcuts SHALL explicitly reference the bundled desktop ICO. Updating an existing application shortcut SHALL preserve target and other metadata and SHALL NOT delete system icon caches or restart Explorer.
#### Scenario: Icon preparation and packaging
- **WHEN** the desktop build completes
- **THEN** source/embedded ICO and exe/setup resources include the generated15 icon sizes, including48/64/84/96/128/256.
#### Scenario: Existing shortcut icon update
- **WHEN** an existing app-owned shortcut is upgraded
- **THEN** its icon location changes to the bundled ICO while target/arguments/description remain unchanged, and only that item receives a shell update notification.
