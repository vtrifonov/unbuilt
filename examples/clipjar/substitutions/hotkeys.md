# Hotkeys

## What the original used

KeyboardShortcuts, a Swift package that registers a system-wide hotkey and supplies a recorder control for settings windows. The original defaults to Shift-Command-V.

## What a replacement must provide

- A hotkey that fires on key down while any other app is in front (PICKER-1).
- A recorder in the settings window that refuses a candidate without Command, Option or Control, and can clear the hotkey (PICKER-2).
- A persisted choice with a default, readable so the picker header and menu can show it.
- No permission prompt of its own. The paste permission is the only one the tool may ask for (`constraints.md`).

## Known alternatives

The platform's classic hotkey registration interface with your own recorder; another hotkey package. A low-level event tap needs an extra system permission, which makes it a poor choice here.

## How to tell it is right

The picker's hotkey scenarios pass: the default hotkey opens and closes the picker from another app without changing the active app, a Shift-only choice is refused, and a cleared hotkey leaves the icon as the way in. The choice survives a relaunch.
