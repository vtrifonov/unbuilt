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
- The clipjar example matched every fact in the brief's table, so there are no differences to report. The source adds a few behaviours the example also records: a one-instance lock, corrupt-database recovery, secure deletion, backup exclusion, and a script that fails on any network API.

## Plugin

### 0.1.0 (Unreleased)

- Skills `extract`, `build` and `validate`, invoked as `/unbuilt:extract`, `/unbuilt:build` and `/unbuilt:validate`. The marketplace is named `unbuilt`, so the install id is `unbuilt@unbuilt`.
- Prompt fallbacks in `prompts/` for agents that are not Claude Code.
- A starting template and the `examples/clipjar` instance.
