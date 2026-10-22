# clipjar

This instance was derived by hand from the public source, documentation and issues of the reference implementation. Nobody confirmed it, so every MUST is marked `(inferred)`.

## What it is

Clipjar is a clipboard history that lives in the macOS menu bar. It records what the user copies (text, links, images and file lists), keeps it locally, and lets the user press a global hotkey, type a few letters, press Return and have the chosen clip pasted into the app they were using. It has no network code, no accounts and no analytics.

## Who it is for

It is for people on a Mac who copy and paste all day and want to reach an earlier copy from the keyboard. It is also a worked example of an unbuilt instance with a small native app, a local database, a global hotkey and one sensitive system permission.

## How to build it

Run the `/unbuilt:build` skill from the unbuilt plugin on this directory, or paste `prompts/build.md` from the unbuilt repository into your agent. Build the milestones in the order `BUILD.md` gives them. The platform facts that bound every build are in `constraints.md`, and the two points where a builder's choice of library is free are in `substitutions/README.md`.

The original is written in Swift 6.2 and built with Swift Package Manager plus a Makefile that assembles, signs and packages the app bundle. It is licensed MIT. This instance carries its own MIT license, separate from the original's.

## Terms

The author asks two things of builders. Tell the author if you build it. Keep the paste-injection permission prompt honest: it must say plainly why the Accessibility permission is requested and what it is used for.
