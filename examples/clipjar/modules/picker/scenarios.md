# Picker scenarios

Rewritten from the original's tests.

## The hotkey toggles the picker

Covers: PICKER-1, PICKER-3
Given a text editor is the active app
When the user presses the global hotkey
Then the picker appears over it with the search field focused and the editor still active, and pressing the hotkey again closes it.

## The hotkey can be changed or cleared

Covers: PICKER-2
Given the default hotkey
When the user records one with only Shift, then one with Option
Then the first is refused with a reason and the second opens the picker
And after clearing it only the menu bar icon opens the picker.

## Keyboard-only selection

Covers: PICKER-4
Given twelve clips
When the user opens the picker, presses Down twice, Command-Up, then Command-3
Then the selection moves to row three, back to row one, and row three is chosen
And Escape clears a non-empty search, and a second Escape closes the picker.

## Search narrows the list

Covers: PICKER-5
Given clips from two apps, including a link
When the user types a word, adds an at sign and an app name, then is:link
Then each term narrows the list, a quoted phrase matches only exactly, and Tab moves to the next chip
And an accented word is found by its unaccented, upper-case form.

## Preview before choosing

Covers: PICKER-6
Given an image clip is selected
Then the full-size image shows beside the list.

## Pinning

Covers: PICKER-7
Given an unpinned clip is selected
When the user presses Command-P
Then it shows a pin mark and appears under the Pinned chip, and a second press removes the mark.

## Delete with undo

Covers: PICKER-8
Given an unpinned clip is selected
When the user presses Command-Delete
Then it leaves the list with an undo notice, and Command-Z restores it
And on a pinned clip the first press only asks for a second.

## Banners explain problems

Covers: PICKER-9
Given the paste permission is missing
When the picker opens
Then a banner offers the system settings page, and it is gone at the next open once the permission is granted.
