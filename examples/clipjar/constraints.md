# Constraints

- The build MUST target macOS 14 or later and MAY use any language and toolkit that runs there.
- The tool MUST NOT use the network in any way: no network framework, socket, web view or remote fetch, and no rich-text import path that fetches subresources.
- Paste injection MUST require the Accessibility permission. The prompt and every place that asks for it MUST say why: it is used only to send the paste key press to the app the user was in.
- Without that permission the tool MUST still work: choosing a clip then copies it, and the user pastes it themselves.
- History is stored unencrypted. The build MUST disclose this in the settings window and in its own readme, with the location `~/Library/Application Support/Clipjar` and the fact that only the user's account can read it.
- The support directory and its files MUST be accessible to the user's account only, and SHOULD be excluded from system backups.
- The tool MUST NOT include third-party telemetry, analytics, crash reporting or accounts.
- The tool MUST NOT save content that the source app marks as concealed or transient.
- The tool SHOULD run as a menu bar app with no Dock icon and no main window.
- The tool SHOULD allow one running instance per support directory. A second launch hands over to the first and exits.
- The tool SHOULD be fully operable from the keyboard, label its controls for a screen reader, and respect the system reduce-motion and increase-contrast settings.
- The tool MAY be distributed ad-hoc signed. `known-failures.md` explains what that costs.
