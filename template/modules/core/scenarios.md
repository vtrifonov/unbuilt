# Scenarios

<!-- One level-2 section per scenario. Each cites at least one declared ID, for example `Covers: CORE-1` (FORMAT.md §3). -->

## Capture a note

<!-- Given, When, Then lines describing behaviour, not code (FORMAT.md §3). -->

Covers: CORE-1, INV-1
Given the tool is running and the note list is empty
When the user presses the capture key and types a short note
Then the note is saved on the local disk and appears in the list

## List notes

<!-- Given, When, Then lines describing behaviour, not code (FORMAT.md §3). -->

Covers: CORE-2
Given two notes were saved, the second one later
When the user opens the note list
Then the later note is shown first
