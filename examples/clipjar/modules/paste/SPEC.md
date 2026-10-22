# Paste requirements

- **PASTE-1** (MUST) (inferred) Choosing a clip writes it to the system clipboard in every representation it holds: plain and rich text, the image, or the file references. The write carries the tool's own marker, and the picker closes.
- **PASTE-2** (MUST) (inferred) Paste injection synthesises the paste key press, Command-V, exactly once into the app that was in front when the picker opened. It first brings that app forward and confirms it is in front. If that takes more than about a quarter of a second, or there is no such app, nothing is pasted and the clip stays on the clipboard.
- **PASTE-3** (MUST) (inferred) Paste injection needs the Accessibility permission. Without it the tool never synthesises a key press, and choosing a clip only copies it.
- **PASTE-4** (MUST) (inferred) While one paste is in progress, a second choice by Return, digit shortcut or click is ignored, so the key press is sent exactly once.
- **PASTE-5** (MUST) (inferred) Option-Return, and every choice made while automatic pasting is off in the settings, copies the clip without pasting.
- **PASTE-6** (SHOULD) (inferred) Wherever the tool asks for the permission it says why: it is used only to send the paste key press to the app the user was in. The banner and the settings window lead to the system's Accessibility page, and the system's own prompt shows at most once per launch.
- **PASTE-7** (SHOULD) (inferred) A chosen clip counts as just copied and moves to the top. Failing to record that never changes the outcome of the paste.
- **PASTE-8** (SHOULD) (inferred) When the tool runs from the read-only temporary location macOS uses for quarantined apps, called App Translocation, it shows a banner saying to move the app to the Applications folder so granted permissions stick.
