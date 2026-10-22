# Known failures

Written only from evidence in the reference implementation's readme, build files and source, not from the author's account.

## Ad-hoc signed, not notarized

The original is ad-hoc signed and not notarized, as a comment on its signing step says. Gatekeeper therefore asks the user to confirm the first launch: a context-menu Open, or Open Anyway in the privacy settings on newer macOS, or clearing the quarantine mark from a terminal.

Each build is also signed ad hoc, so after an update macOS no longer recognises the permission it recorded for the previous build. The user must remove the app from the Accessibility list and add it again, or reset the permission from a terminal and relaunch. A stable signing identity would avoid this.

## App Translocation breaks the Accessibility grant

When the app runs straight from the downloads folder, macOS runs it from a randomised read-only location, called App Translocation, and the Accessibility permission granted there does not stick. The readme tells users to move the app to Applications first. The original also detects the location and shows a banner (PASTE-8). See `evidence/2026-10-22-app-translocation.md`.

A build should therefore never make paste injection the only way to use a clip (PASTE-3).
