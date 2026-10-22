# Storage

## What the original used

GRDB.swift, a Swift wrapper, over SQLite, with a full-text index on the clips and a small migration list. Large images live as files beside the database.

## What a replacement must provide

- Durable local storage readable by the user's account only (HISTORY-1, HISTORY-6).
- A uniqueness rule on a content fingerprint (HISTORY-2).
- Substring search over case- and accent-folded text, fast for ten thousand clips while typing (PICKER-5). The original used a three-character-gram index, with a plain pattern match for shorter terms.
- Change notification, so an open picker follows arrivals and removals.
- Real erasure from the main file, the index and any journal (HISTORY-5). The original enabled secure deletion, rebuilt the index after deletions and truncated the write-ahead log.
- Integrity checking, and setting a damaged store aside (HISTORY-7).
- An in-memory mode (HISTORY-8).

## Known alternatives

SQLite used directly through the platform's bindings; another embedded database with the same erasure guarantees; plain files with your own index, which makes erasure and search your problem.

## How to tell it is right

The history scenarios pass. Delete a clip holding a distinctive phrase and search every file under the support directory for it, journals included. Corrupt the main file and confirm an empty history starts and the damaged file is kept.
