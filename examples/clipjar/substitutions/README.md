# Substitutions

Two places where a builder's environment may differ from the original. Cells say how much a module depends on a point: `required`, `optional` or `-` for none.

| Module | storage | hotkeys |
|---|---|---|
| CAPTURE | - | - |
| HISTORY | required | - |
| PICKER | optional | required |
| PASTE | optional | - |
| SETTINGS | optional | - |

The original used Swift 6.2 with the system UI toolkits, GRDB.swift over SQLite for storage, and KeyboardShortcuts for the hotkey. The paste permission is fixed by the platform and is not a substitution point.
