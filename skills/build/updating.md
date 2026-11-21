# Updating a build

The build skill reads this file on an update run. Step numbers and the sections it names, such as "Git and shell safety" and "The baseline", are those of the build skill's `SKILL.md`, and every rule there still applies.

### Order of checks

Any `/unbuilt:build <instance>` in a project with a matching `PLAN.md`, and any `continue`, runs this before anything else, in this order:

1. The URL and path guards and the nesting check.
2. The `.unbuilt` checks and recovery.
3. Acquire and snapshot.
4. Validate the snapshot.
5. The name check. A snapshot `name` that differs from `unbuilt-instance` stops as the project-directory rule says, until the builder edits the header.
6. The diff.

The only exception is scripts that cannot run, as in step 1.

### Validate first

Validate the new revision before you compare or plan against it. Warnings are listed and do not block. When the snapshot fails, the validator reports errors on the snapshot, or the diff exits 2 with stderr that does not start with `old: `, list the errors as quoted data and say the update is blocked until the cause is fixed. Leave `PLAN.md` and the baseline untouched. If unchecked milestones remain and a baseline exists, offer to continue on it.

### Detect

Compare the baseline with the snapshot:

```
node <unbuilt-root>/scripts/diff.mjs '<project-dir>/.unbuilt/baseline' '<scratch>/snapshot' --json
```

Read that output for planning. Run the same command without `--json` for the summary shown to the builder.

- Exit 0 is no change and exit 1 is change. A commit hash difference alone never triggers an update.
- Exit 2 with a baseline: branch only on the fixed stderr prefix. When it starts with `old: `, the baseline cannot be compared: tell the builder, quote stderr and take the legacy flow. Otherwise handle it as in "Validate first".
- With a change, show the summary and ask one question: update now (the default) or stay on the recorded revision.
- Stay writes nothing. The next unchecked milestone runs against the baseline, or completion is reported.
- After a stay, a later `continue` in the same session with the same diff document says the build stays on the recorded revision and proceeds. A different diff, or a new session, asks again.

### Plan the update

Plan from the diff JSON, the snapshot and `PLAN.md`.

1. Show a change summary from the diff's human output, grouped as the JSON is, with IDs, numbers and quoted titles only, never full requirement or scenario text.
2. Re-ask only the step 4 questions the change touches, each with options and a default:
   - a substitution point added: question 1;
   - a substitution point removed: keep the chosen implementation as an `addition` (the default) or follow the spec;
   - a module added: question 2, on by default for `shipped` and `partial`, off for `sketched` and `abandoned`;
   - a module removed with IDs in a finished or partially built milestone: one question, as for retired code below;
   - `constraints.md` in `files.changed`: question 4. If a MUST constraint cannot be met, stop and keep the old plan and baseline.
3. Read the full new text only for the IDs, scenarios and files the diff lists.
4. Classify every affected ID by the IDs the current plan covers, never by milestone number: in a finished milestone, in an unbuilt milestone, or not yet planned. An added ID is in the finished area only when its module already has IDs in a finished milestone and the module is not new. IDs of excluded modules go to "Not built".

### The update milestone

- All work on finished areas goes into one update milestone, inserted immediately before the next unchecked milestone, or appended, so it runs next. Unchecked update milestones already in the plan merge into it: items for IDs the new diff touches are rebuilt from the new text, the rest are carried over, and the merged one takes the next `<n>`. When this run creates none, each unchecked update milestone keeps its heading and number ahead of the re-derived milestones, and only its touched items are rewritten.
- Split it into parts `a`, `b`, and so on only when it would cover more IDs than the largest original milestone. Each part holds one affected finished milestone's items in that milestone's order. Constraint and substitution items go in the first part.
- Re-derive every other unbuilt milestone from the new `BUILD.md` by IDs: every covered ID minus those of finished milestones, of every update milestone and of excluded modules, grouped by the new `BUILD.md` milestone that covers them, in `BUILD.md` order with its title, after the update milestones. Each keeps its `BUILD.md` number unless already used, then takes the smallest larger unused number. One left with no IDs is dropped, and the plan says so. Milestones run in plan order. An unparseable new `BUILD.md` follows the step 5 rule for proposed milestones.
- Then apply the step 5 rule for uncovered IDs to the whole plan. It catches an added ID that the new `BUILD.md` does not cover and a previously covered ID that it no longer covers.
- Finished milestones keep checkbox, number, title and covered IDs. Nothing in them is rewritten.
- One item per change:

| Change | Item |
|---|---|
| Added ID in a finished area | A failing test from its scenarios, then code. |
| Changed text | Update or add the test first and watch it fail, then change the code. If the updated test already passes, record "no code change" with the test name. |
| MUST to SHOULD or MAY | No code, a note in the plan. |
| SHOULD or MAY to MUST | A required item, after the departure rules below. |
| Inferred flag only | A note only. |
| Retired | As in the departure rules below. |
| Removed without a retired line | Reported as below, then handled as retired. |
| Changed scenario | Its test is updated first. |
| Changed substitution contract for a chosen substitution | An item to bring the chosen implementation in line. |
| Changed constraint | An item to bring all finished code in line. |
| Prose-only files (`problem.md`, `decisions/`, `known-failures.md`, `evidence/`, `README.md`, `design/`) | Listed in the summary, no item unless the builder asks. |

- Changes to IDs in unbuilt milestones need no item. A retired or removed ID in an unbuilt or unplanned area is dropped without a question, except an ID with a departure or addition line, and an ID in the next unchecked milestone that already has tests or code.
- The update milestone runs with the flow of steps 6 and 7.

### Departures and retirements

These rules apply to every ID with a departure or addition line, wherever it sits.

Never override a recorded departure or addition without asking the builder.

- Changed text or modality on an ID without a departure is applied in the update milestone or the re-derived milestone.
- With a departure, ask: keep it, re-recorded with the new `Agreed at` (the default), adopt the new text, or adjust the departure.
- If the ID became a MUST, offer only adopt or stay on the recorded revision. Stay abandons the whole update and writes nothing.
- A retired or removed ID that has code, in a finished milestone or in the next unchecked milestone with tests or code: ask whether to keep it as an `addition` (the default) or remove the code and its tests as an update milestone item. Ask one question per removed module.
- An added ID that overlaps an `addition` line: ask whether it replaces the addition.
- Report each ID removed without a retired line once, in a sentence that names the ID and its file, says the instance removed it without a retired line, asks the builder to raise it with the author, and says it is treated as retired. This holds whenever its module still exists. Only when the whole module was removed, give one such sentence per module, naming the module, instead of one per ID.

### Legacy plans

A legacy plan is a matching `PLAN.md` with no `.unbuilt/baseline/`, or a baseline the diff cannot read. Never reconstruct a baseline from a recorded hash.

- No milestone is checked: rewrite the plan against the snapshot, keeping recorded answers and asking the legacy questions. Show it, and on go-ahead write it and the baseline in the write order.
- A git URL source with no baseline whose clone `HEAD` equals the recorded `unbuilt-revision` (the revision guard applies): write the baseline in the write order with `PLAN.md.next` an unchanged copy of `PLAN.md`. Tell the builder once that update tracking is now on, with the `.unbuilt/` notice, and continue as before.
- Every other case: say the build predates update tracking, or that the baseline cannot be read. Ask the legacy questions and re-derive the unbuilt milestones against the new text. Offer a re-check of finished milestones, naming `constraints.md` as part of it: each finished milestone's covered IDs and `constraints.md` are re-read, and anything the code does not meet becomes an update milestone item, with the departure rules applying. The builder may decline the re-check only. Show the plan, and on go-ahead write it, rewrite the header and write the baseline.
- The legacy questions: a module of the snapshot's `unbuilt.yaml` that is neither included nor under "Not built" gets question 2 with the defaults above. A substitution point not among the plan's chosen substitutions gets question 1. Recorded answers for everything else are kept.

### Approval

Show the revised `PLAN.md` as a diff against the current one and stop. The scratch directory stays, as "Git and shell safety" says. Write nothing before the builder's explicit go-ahead. If they decline, write nothing and ask again on the next `continue`. On go-ahead, rewrite the header and write in the write order of "The baseline". Do not start the update milestone. End with the continue sentence naming it. If this run's snapshot no longer exists, write nothing and run the update check again.
