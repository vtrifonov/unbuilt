# Settings requirements

- **SETTINGS-1** (MUST) (inferred) The user can choose how many clips to keep: 200, 1,000, 5,000, 10,000 or unlimited, defaulting to 1,000. They can also remove clips older than a day, a week, a month, three months or a year, defaulting to no age limit. Choices persist and apply at once.
- **SETTINGS-2** (MUST) (inferred) A change of limits that would remove clips waits for confirmation, which says how many clips would go. Cancelling keeps the previous limits.
- **SETTINGS-3** (MUST) (inferred) The user can pause capture until resumed, or for fifteen minutes. A timed pause ends by itself, even if it expires while the Mac sleeps or the tool is not running. The paused state shows in the picker and on the menu bar icon.
- **SETTINGS-4** (MUST) (inferred) The ignore list can be edited: apps can be added and removed. Initially it holds the system's keychain and password apps and well-known password managers, and it shows a clear empty state when emptied.
- **SETTINGS-5** (SHOULD) (inferred) A setting, on by default, controls whether choosing a clip pastes it automatically. Beside it the window shows whether the Accessibility permission is allowed, with a way to the system page when it is not.
- **SETTINGS-6** (SHOULD) (inferred) The user can clear the history after a confirmation that says it cannot be undone. Pinned clips are kept.
- **SETTINGS-7** (MAY) (inferred) A setting launches the tool at login, and shows the approval requirement or registration error when one applies.
- **SETTINGS-8** (SHOULD) (inferred) A plain click on the menu bar icon toggles the picker. A right click or Control-click opens a menu with Open, Pause for 15 Minutes, Pause or Resume, Settings and Quit. The icon dims briefly on each capture, except when the system asks for reduced motion.
