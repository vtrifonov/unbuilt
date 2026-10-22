# Changelog

## Format

### 1 (Unreleased)

- Required files and the `unbuilt.yaml` schema: README, SPEC, constraints, BUILD, redaction record, modules and design inventory, with optional substitutions, decisions, evidence, known failures and retrospective.
- Twenty-eight validator rules covering structure, requirement IDs, modality, scenarios, size budgets and mechanical redaction checks (emails, IP addresses, hostnames, home paths, secret shapes, unscannable files).
- A small YAML subset that the validator parses itself, so the format needs no dependencies.

Notes (deliberate spec interpretations, recorded here because the branch merges into `main` without a pull request):

- A retired-shaped requirement ID line yields one finding. `id-format` does not report a declaration attempt that `id-retired-form` already owns, so each bad line is reported once, not twice. This is a deliberate reading of the spec.
- A non-numeric `unbuilt` value such as `"1"` or `two` is a `yaml-fields` error. The unsupported-version short-circuit fires only for a number other than 1.
- An `.svg` file is an allowed image only when it is a text file. A binary, NUL-bearing or UTF-16 `.svg` is a `file-types` error, because it cannot be scanned for leaks.
- Extract: the rename target for `name` must not exist or must be an empty directory; otherwise the skill asks for another name. When the output directory already holds an `unbuilt.yaml`, the skill asks whether it is a published instance or an unfinished draft. A draft keeps first-extraction rename rights; a published instance follows update mode.
- Security hardening: the leak scan runs in linear time; image metadata inflation is capped at 1 MiB per image and 8 MiB per run; png, jpeg and webp rasters embedded as base64 `data:` URIs are scanned, and any other `data:image/` URI is an error; a credential key must end in a credential noun, and a `Bearer` value needs a digit, and header context or a digit and a letter in each half.
- Validator rulings: leak rules also scan file and directory paths and mask the `file` column; any entry named `.git` is skipped; a module path is `modules/` plus one kebab-case name; `unbuilt.yaml` rejects control characters, U+2028, U+2029 and a non-leading BOM; an unreadable instance directory exits 2; inline HTML comments are scoped to their paragraph; URL hosts are compared after stripping trailing punctuation and in punycode.
- `FORMAT.md` exceeds the 2,500-word target of R-FMT-3 (a SHOULD) under R-FMT-43 (a MUST): section 7 spells out how each declined name in `unbuilt.yaml` is renamed. The repository test allows 2,600 words.
- The clipjar example matched every fact in the brief's table, so there are no differences to report. The source adds a few behaviours the example also records: a one-instance lock, corrupt-database recovery, secure deletion, backup exclusion, and a script that fails on any network API.

## Plugin

### 0.1.0 (Unreleased)

- Skills `extract`, `build` and `validate`, invoked as `/unbuilt:extract`, `/unbuilt:build` and `/unbuilt:validate`. The marketplace is named `unbuilt`, so the install id is `unbuilt@unbuilt`.
- Prompt fallbacks in `prompts/` for agents that are not Claude Code.
- A starting template and the `examples/clipjar` instance.
- Extract update mode takes an optional `since <ref>`: it reads only the source files changed after that git revision, interviews only about the affected modules, and still runs the redaction gate over the whole instance.
- Running `/unbuilt:build` again in a built project re-validates a snapshot of the instance, reports what changed with `scripts/diff.mjs`, and plans an update milestone for finished work. `scripts/snapshot.mjs` makes every copy of instance text, `PLAN.md` gains a `## Departures` section, and the project keeps the last approved instance text in `.unbuilt/baseline/`.
