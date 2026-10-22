# Spec

## Goal

Let a person reach anything they copied earlier from the keyboard, without leaving the app they are in, and paste it back in a few keystrokes. Everything stays on the person's Mac.

## Glossary

- **Clip**: one captured copy: text, a link, an image or a list of files, with its source app and the time it was last copied.
- **History**: the stored clips, newest first by last-copied time.
- **Picker**: the floating panel that lists clips, searches them and previews the selected one.
- **Paste injection**: sending a synthetic paste key press to the app that was in front before the picker opened.
- **Pin**: a mark that keeps a clip out of automatic removal.
- **Ignore list**: apps whose copies are never captured.
- **Concealed content**: a copy the source app flags as secret or short-lived, such as a password.
- **Pause**: a state in which nothing is captured, for a set time or until the user resumes.
- **Type chip**: a filter on the picker for one kind of clip, or for pinned clips.
- **Support directory**: the folder under the user's library where history is stored.

## Invariants

- **INV-1** (MUST) (inferred) The tool never makes a network connection of any kind, and never contacts a remote service for any purpose, including previews, updates or crash reports.
- **INV-2** (MUST) (inferred) The system clipboard is written only as the direct result of a user action that selects a clip. Capturing never changes the clipboard.
- **INV-3** (MUST) (inferred) Clip content never leaves the machine, and is never written to a log or to any location outside the support directory.

## Exclusions

- It is not a sync service and does not share history between devices.
- It is not a cloud clipboard.
- It is not a password manager. It deliberately skips content that looks like a secret.
- It is not a text expander or snippet library.
