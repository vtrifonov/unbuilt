# Settings scenarios

Rewritten as behaviour from the original's tests of the settings store and the retention changer.

## Lowering the limit asks first

Covers: SETTINGS-1, SETTINGS-2
Given 300 unpinned clips and a limit of 1,000
When the user chooses a limit of 200
Then a confirmation says 100 clips would be removed, cancelling keeps everything, and confirming removes the 100 oldest.

## A harmless change applies at once

Covers: SETTINGS-1
Given 50 clips
When the user raises the limit and sets an age limit
Then no confirmation appears and both choices survive a restart.

## A timed pause ends by itself

Covers: SETTINGS-3
Given capture is paused for fifteen minutes
When the Mac sleeps past the end and wakes, or the tool is relaunched after the end
Then capture is running again and the menu bar icon no longer looks disabled.

## The ignore list is editable

Covers: SETTINGS-4
Given the default list
When the user adds an app, then removes every entry
Then the list shows No ignored apps and copies from those apps are captured again.

## Automatic paste can be switched off

Covers: SETTINGS-5
Given the permission is granted
When the user switches automatic pasting off
Then choosing a clip only copies it, and the window still shows the permission as allowed.

## Clearing the history

Covers: SETTINGS-6, HISTORY-5
Given pinned and unpinned clips
When the user chooses Clear History and confirms
Then every unpinned clip is erased and the pinned ones remain.

## Launch at login

Covers: SETTINGS-7
Given the system requires approval for login items
When the user turns launch at login on
Then the window says approval is needed and offers the login items page.

## The menu bar icon

Covers: SETTINGS-8
Given the tool is running
When the user clicks the icon, then right-clicks it
Then the click toggles the picker and the right click opens a menu of five entries
And Pause for 15 Minutes dims the icon and says so in its tooltip.

## Nothing leaves the machine

Covers: INV-1, INV-3
Given a day of use with network traffic and file writes monitored
When the user has copied text, images and files and used every setting
Then the tool made no connection and wrote no clip text to a log or outside the support directory.
