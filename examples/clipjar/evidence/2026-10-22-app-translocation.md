# App Translocation and the Accessibility permission

Checked: 2026-10-22
Expires: 2027-10-22

Finding: an app launched from a quarantined location, such as the downloads folder, runs from a randomised read-only path, and the Accessibility permission granted there is not kept for its real location. Moving it to the Applications folder before the first launch avoids this.

Basis: the reference implementation's readme states the behaviour and its source detects the temporary path. To re-check, see the platform's documentation of the assistive-access trust check at https://developer.apple.com/documentation/applicationservices. That page was not fetched for this entry, so treat the finding as the original author's documented observation until a builder confirms it.

Builders: re-check after the expiry date and on any newer macOS release.
