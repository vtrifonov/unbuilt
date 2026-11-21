# Rebuilding clipjar in Rust from the spec

Can a spec rebuild its app? This is one test of that. [`examples/clipjar/`](../clipjar/) was extracted from a Swift app. Here it was rebuilt from that spec alone, in a different language and with different libraries, by following `/unbuilt:build` milestone by milestone.

**How it was built.** An AI coding agent (Claude Code running the `build` skill) wrote all of the code and tests. The author answered the builder questions, approved the plan, and did the checks that need a person at the Mac. Treat it as an agent-built rebuild under supervision, not as hand-written code.

## Stack

| | Original | Rebuild |
|---|---|---|
| Language | Swift 6.2 | Rust 1.97, edition 2024 |
| UI | AppKit | AppKit through the `objc2` crates |
| Storage | GRDB | SQLite through `rusqlite`, bundled |
| Hotkey | KeyboardShortcuts | Carbon `RegisterEventHotKey`, own recorder |

The rebuild is two crates. `clipjar-core` holds every decision the spec makes: capture rules, store, search, picker model, paste steps and settings. It has no AppKit, so `cargo test` covers it. `clipjar-app` is a thin AppKit shell over it. In total that is 3,300 lines of Rust and 108 tests. A build script checks the finished binary for any network framework or socket symbol.

**Rejected before any code: Tauri and Electron.** Both are common choices for a small tray app, and both draw their UI in a web view. `constraints.md` rules it out in one line: no network framework, socket or **web view**. The spec stopped a plausible stack before anything was built, which is what the constraints file is for.

## Milestones

Every milestone followed the same loop. The failing tests came first (in Rust, "red" is usually a compile failure), then the code, then the full suite.

| Milestone | New tests | Total | First try? | Checked at the Mac |
|---|---|---|---|---|
| 1. Capture and list in memory | 17 | 17 | Core tests passed the first time; the app had 2 compile errors (a missing crate feature) | Yes, by the agent: three clips, newest first, repeat merged |
| 2. Persistent store | 12 | 29 | Yes, core and app | Yes, by the agent with a scratch home folder |
| 3. Hotkey picker | 48 | 77 | Core yes; the app had 17 compile errors, all about API shape, none logic | Yes, by the author. One display bug found from a screenshot |
| 4. Paste injection | 13 | 90 | Core yes; the app had 1 missing feature | Skipped by the author; covered by tests only |
| 5. Settings and limits | 18 | 108 | Core yes; the app had 2 compile errors | Yes, by the author |

The app's compile errors were binding issues, not misreadings of the spec:
- crate features that had to be switched on;
- the `define_class!` macro refusing an early `return`;
- `i64::div_ceil` still being unstable.

No requirement had to be redone after its milestone closed. Milestone 4's paste into another app (the synthetic ⌘V) was never tried by hand. Its decision logic is tested, but the key press itself is not.

## What the spec did not say

Each gap below had to be decided by the builder. None stopped the build, and each would be one line in the spec.

- **The files inside the support folder.** This was the one that caused damage. The spec names `~/Library/Application Support/Clipjar` but not the files in it. The author's Mac also had the original app installed, which keeps `clips.sqlite` in that folder. The rebuild picked the same name and added its tables to the original's database during milestone 3 testing. Nothing of the original's was changed, but a failed integrity check would have set the original's database aside as damaged. The fix was the author's call: keep the folder (a MUST) and give every rebuild file a `clipjar-rs` prefix. Any faithful rebuild tested next to the original will hit this.
- **Backups.** `constraints.md` says the support folder SHOULD be kept out of backups. That assumes the tool owns the folder, so the rebuild excludes only its own files. This item was also missed until milestone 5: a constraint read at plan time still needs a test or a checklist line.
- **Undefined terms:**
  - CAPTURE-1's "web address": the build took `http` and `https` only.
  - CAPTURE-3's "known password-manager marker": the build chose six types.
  - SETTINGS-4's "well-known password managers": the build chose nine apps.
- **Search** (PICKER-5): `@app` could match the bundle id or the app name, several `is:` filters could AND or OR, and a quoted phrase could be case-sensitive or not. The build chose bundle id, AND, and literal.
- **Numbers left vague:**
  - PICKER-8's undo window: the build chose 5 seconds.
  - PASTE-2's "about a quarter of a second": the build uses a 250 ms deadline.
- **Unspecified triggers and forms:**
  - HISTORY-7's "later check": the build runs an integrity check after a failed write.
  - HISTORY-8's lock: the build uses an exclusive lock file.
  - SETTINGS-3 says the paused state "shows" without saying how: the build uses a notice line and a dimmed icon.
- **Keyboard layouts.** ⌘V is sent by key code, so a layout whose Command shortcuts follow the layout could paste wrong. The spec does not mention layouts.

## Departures

None. `PLAN.md` records no departure from a requirement. Two differences from the approved plan did not touch the spec:
- Search runs in memory over the clips instead of using the full-text index the plan mentioned.
- Two approved binding crates were never needed.

## What it shows

The spec was enough to rebuild a working app in another language without reading the original's code. Five milestones produced 108 tests, three of the five were checked by hand, and no requirement was rewritten. The weak spots were the things extraction treats as implementation detail: file names, which apps count as password managers, and exact timings. The only one that caused real trouble was a file name.

The rebuild's code is not published. This page reports the run.
