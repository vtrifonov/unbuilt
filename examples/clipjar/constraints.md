# Constraints

- The build MUST target macOS 14 or later and MAY use any language and toolkit that runs there.
- The tool MUST NOT use the network in any way. No network framework, no socket, no web view, no remote fetch, and no import path that fetches subresources while converting rich text.
- Paste injection MUST require the Accessibility permission. The permission prompt and every place that asks for it MUST say why: the permission is used only to send the paste key press to the app the user was in.
- Without the Accessibility permission the tool MUST still work. Selecting a clip then copies it and the user pastes it themselves.
- History is stored unencrypted. The build MUST disclose this to the user, in the settings window and in its own readme, together with the location `~/Library/Application Support/Clipjar` and the fact that the files are readable by the user's account only.
- The support directory and its files MUST be readable and writable by the user's account only.
- The support directory SHOULD be excluded from system backups.
- The tool MUST NOT include third-party telemetry, analytics, crash reporting or accounts.
- The tool MUST NOT save content that the source app marks as concealed or transient.
- The tool SHOULD run as a menu bar app with no Dock icon and no main window.
- The tool SHOULD allow only one running instance per support directory. A second launch hands over to the first and exits.
- The tool SHOULD be fully operable from the keyboard, SHOULD label its controls for a screen reader, and SHOULD respect the system reduce-motion and increase-contrast settings.
- The tool MAY be distributed unsigned or ad-hoc signed. `known-failures.md` explains what that costs the user.
