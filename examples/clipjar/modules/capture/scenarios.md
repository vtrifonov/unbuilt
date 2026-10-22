# Capture scenarios

Rewritten from the original's tests.

## A copy becomes a clip

Covers: CAPTURE-1, CAPTURE-8, INV-2
Given the tool is running with an empty history
When the user copies a sentence in a text editor
Then one text clip appears, sourced from the editor, and the clipboard is unchanged.

## Kinds are told apart

Covers: CAPTURE-1
Given the tool is running
When the user copies a single web address, then only whitespace, then a file, then a screenshot
Then they become a link clip, nothing, a file clip and an image clip.

## The clipboard at launch is left alone

Covers: CAPTURE-2
Given the clipboard holds text copied before the tool started
When the tool starts
Then the history stays empty, and a later copy is captured.

## Secrets are not captured

Covers: CAPTURE-3
Given a password manager copies a password marked concealed
When the tool checks the clipboard
Then no clip is created and the content is never read, and the same holds for transient and auto-generated copies.

## Ignored apps are skipped

Covers: CAPTURE-4
Given an app is on the ignore list
When the user copies from it and switches to another app before the next check
Then no clip is created.

## The tool does not capture itself

Covers: CAPTURE-5, INV-2
Given the user chooses a clip in the picker, which writes the clipboard
When the tool checks the clipboard
Then the history gains no clip.

## Nothing is captured while paused

Covers: CAPTURE-6
Given capture is paused
When the user copies a sentence and the pause then ends
Then that sentence is never captured, and a later copy is.

## Oversized copies are skipped

Covers: CAPTURE-7
Given the tool is running
When the user copies several megabytes of text, then a short text with a huge rich-text version
Then the first creates no clip and the second keeps only its plain text.
