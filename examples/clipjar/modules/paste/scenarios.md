# Paste scenarios

Rewritten as behaviour from the original's tests of the paster, the paste gate and the system adapters.

## A permitted paste

Covers: PASTE-1, PASTE-2, PASTE-3, PASTE-7, INV-2
Given the Accessibility permission is granted and a text editor was in front when the picker opened
When the user presses Return on a clip
Then the clip is written to the clipboard, the picker closes, the editor comes forward, exactly one paste key press reaches it, and the clip moves to the top.

## Without the permission it only copies

Covers: PASTE-3, PASTE-6
Given the permission has not been granted
When the user presses Return on a clip
Then the clip is on the clipboard, no key press is sent, and a banner says why the permission is needed and offers the system page.

## Copy without pasting

Covers: PASTE-5
Given the permission is granted
When the user presses Option-Return, or Return with automatic pasting switched off
Then the clip is on the clipboard and nothing is pasted.

## Rapid double choice

Covers: PASTE-4
Given a paste is in progress
When the user presses Return and then Command-1 before it ends
Then the second choice is ignored and the target receives one paste.

## The target cannot be reached

Covers: PASTE-2
Given the app that was in front has quit
When the user presses Return
Then the clip stays on the clipboard and nothing is pasted, as when the picker was opened while the tool itself was in front.

## A failed recency update does not undo a paste

Covers: PASTE-7
Given the history cannot be written right now
When the user chooses a clip
Then the paste still succeeds and the failure shows the usual storage banner.

## Quarantined location

Covers: PASTE-8
Given the app runs from the temporary location used for quarantined apps
When the picker opens
Then a banner asks the user to move the app to the Applications folder, and it cannot be dismissed.

## The system prompt appears once

Covers: PASTE-6
Given the permission is missing
When the user presses the banner's action twice in one launch
Then the system's permission prompt appears once.
