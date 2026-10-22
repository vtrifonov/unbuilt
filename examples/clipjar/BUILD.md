# Build

The author may reorder these milestones. Each leaves a runnable tool.

## Milestone 1: Capture and list in memory

Covers: CAPTURE-1, CAPTURE-2, CAPTURE-3, CAPTURE-5, CAPTURE-7, CAPTURE-8, HISTORY-2, HISTORY-3, INV-1
Done when: running the tool, then copying a sentence, a link and an image, shows three entries newest first in a minimal window or on standard output, and copying the same sentence again moves it to the top without adding a fourth.
Effort: M

## Milestone 2: Persistent store

Covers: HISTORY-1, HISTORY-5, HISTORY-6, HISTORY-7, HISTORY-8, INV-3
Done when: clips copied before quitting are listed after a restart, deleting a clip leaves no trace of its text in the database files, and a deliberately damaged database is set aside and replaced by an empty one.
Effort: M

## Milestone 3: Hotkey picker

Covers: PICKER-1, PICKER-2, PICKER-3, PICKER-4, PICKER-5, PICKER-6, PICKER-7, PICKER-8, PICKER-9, HISTORY-4
Done when: the global hotkey opens the picker over another app without that app losing focus, typing narrows the list, the selected clip is previewed, and Escape closes the picker.
Effort: L

## Milestone 4: Paste injection

Covers: PASTE-1, PASTE-2, PASTE-3, PASTE-4, PASTE-5, PASTE-6, PASTE-7, PASTE-8, INV-2
Done when: with the Accessibility permission granted, pressing Return on a clip pastes it once into the text field that was focused, and with the permission withdrawn the same key only copies and a banner explains how to grant it.
Effort: M

## Milestone 5: Settings and limits

Covers: SETTINGS-1, SETTINGS-2, SETTINGS-3, SETTINGS-4, SETTINGS-5, SETTINGS-6, SETTINGS-7, SETTINGS-8, CAPTURE-4, CAPTURE-6
Done when: lowering the history limit below the current count asks for confirmation naming the number of clips that would go, a fifteen minute pause captures nothing and ends by itself, and a copy from an ignored app never appears.
Effort: M
