# App Translocation and the Accessibility permission

Checked: 2026-10-22
Expires: 2027-10-22

Finding: an app launched from a quarantined location, such as the downloads folder, runs from a randomised read-only path, and the Accessibility permission granted there is not kept for its real location. Moving it to the Applications folder before the first launch avoids this.

Basis: the check on the date above was made against the reference implementation only. Its readme states the behaviour and its application delegate detects the temporary path. No platform documentation was consulted, so treat the finding as the original author's documented observation until a builder confirms it on their macOS version.

Builders: re-check after the expiry date and on any newer macOS release.
