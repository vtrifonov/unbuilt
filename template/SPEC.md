# Spec

<!-- Root spec: goal, glossary, invariants, exclusions (FORMAT.md §3). -->

## Goal

<!-- One paragraph: the product goal (FORMAT.md §3). -->

Let a person save a thought in one keystroke and find it again later, without leaving what they were doing.

## Glossary

<!-- Terms the specs use, each defined once. Avoid terms shaped like requirement IDs (FORMAT.md §5). -->

- **Note**: a short piece of text the user typed after pressing the capture key.
- **Capture key**: the single key that opens the note box.

## Invariants

<!-- What must hold in every build across modules. One line per invariant in the exact form `- **INV-n** (MUST) text`, never renumbered (FORMAT.md §5). -->

- **INV-1** (MUST) A note never leaves the machine it was typed on.

## Exclusions

<!-- What this is not (FORMAT.md §3). -->

- It is not a document editor.
- It does not sync notes between devices.
