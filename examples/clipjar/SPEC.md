# Spec

## Goal

Let a person reach anything they copied earlier from the keyboard, without leaving the app they are in, and paste it back in a few keystrokes. Everything stays on the person's Mac.

## Glossary

- **Clip**: one captured copy: text, a link, an image or a list of files, with its source app and last-copied time.
- **History**: the stored clips, newest first.
- **Picker**: the floating panel that lists, searches and previews clips.
- **Paste injection**: sending a synthetic paste key press to the app that was in front before the picker opened.
- **Pin**: a mark that keeps a clip out of automatic removal.
- **Ignore list**: apps whose copies are never captured.
- **Concealed content**: a copy the source app flags as secret, such as a password.
- **Type chip**: a picker filter for one kind of clip, or for pinned clips.
- **Support directory**: the folder in the user's library where history is stored.

## Invariants

- **INV-1** (MUST) (inferred) The tool never makes a network connection of any kind, for any purpose, including previews, updates or crash reports.
- **INV-2** (MUST) (inferred) The system clipboard is written only as the direct result of the user selecting a clip. Capturing never changes it.
- **INV-3** (MUST) (inferred) Clip content never leaves the machine, and is never written to a log or anywhere outside the support directory.

## Exclusions

- It is not a sync service and does not share history between devices.
- It is not a cloud clipboard.
- It is not a password manager. It deliberately skips content that looks like a secret.
- It is not a text expander or snippet library.
