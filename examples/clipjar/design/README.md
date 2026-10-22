# Design inventory

Every surface found in the original, from its source. No images. Quoted wording is the original's, offered as a suggestion.

## Menu bar item and menu

Purpose: the always-present entry point, which works with no hotkey.
Key elements: a clipboard-list icon that dims briefly on each capture. A plain click toggles the picker. A right or Control click opens a menu: Open (showing the hotkey), Pause for 15 Minutes, Pause or Resume, Settings, Quit.
States: while paused the icon looks disabled and its tooltip says so. Empty, loading and error do not apply.

## Picker panel

Purpose: find, preview and choose a clip. A borderless rounded panel, 720 by 460 points by default and no smaller than 560 by 340, resizable from a footer grip, remembering its size. It opens near the cursor for the hotkey, under the icon for the icon, and centred on first launch, clamped to the visible screen.
Key elements, top to bottom:
- Header: search field, the hotkey as a badge, a settings button.
- Banners, each with an action.
- Filter bar: six type chips and a count of matches.
- Body: a list beside a preview. A row shows a kind icon or thumbnail, a one-line preview, source app, relative time and a pin mark. The preview shows the whole text with matches highlighted, the full image, or the file list.
- Paused bar with the resume time and a Resume button.
- Undo notice above the footer: "Clip deleted" with Undo, or a request to press delete again for a pinned clip.
- Footer: adaptive key hints, and only "Return Copy" when pasting is off or not allowed.

States:
- Empty: "Your clipboard history is empty", with a hint naming the hotkey or, with none, the icon.
- No results: "No clips match" with the query, Clear Search, and Search All Types when a chip is active.
- Loading: neither list nor message shows until the first rows arrive.
- Error: banners.

## Banners

- Accessibility not allowed: paste needs the permission, Return copies meanwhile; opens the system page. Fixed.
- Clipboard reading denied: opens the privacy settings. Fixed.
- Quarantined location: "Move to the Applications folder so permissions stick". Fixed.
- History reset after damage: shows the support folder in the file manager. Dismissible.
- History not saved this session, last clip not saved, restart needed to repair: text only. Dismissible.

## Settings window

Purpose: the settings module's controls, in one grouped form created once and reused.
- General: hotkey recorder ("Clear to use the menu bar icon only"); "Paste automatically after selecting" with an Accessibility allowed or not allowed line and a link to the system page; "Launch at login".
- History: Keep (five choices), Remove clips older than (six), Clear History.
- Privacy: Pause capture and a fifteen minute button; the Ignored apps list with add and remove buttons and the empty state "No ignored apps"; a footer saying history is stored unencrypted on this Mac and never leaves it.
States: the two pickers revert on Cancel or a store error.

## Confirmation dialogs

- Limit change: "Remove N older clips? Pinned clips are kept." with Remove and Cancel.
- Clear History: "Clear all unpinned clips? This can't be undone."

## First launch and the permission prompt

There is no onboarding wizard. On first launch the picker opens once, centred, showing the empty state. The Accessibility permission is requested lazily: the banner's action opens the system page and triggers the system prompt at most once per launch.
