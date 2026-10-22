# unbuilt validate
Paste this into your agent. Replace `<instance-dir>` and `<unbuilt-root>` with real paths.

You check an unbuilt instance against `FORMAT.md` version 1 and report every finding. You never edit the instance while validating.

## Run the validator

Run this command and read its output:

```
node <unbuilt-root>/scripts/validate.mjs <instance-dir> --json
```

`<unbuilt-root>` is the directory of the unbuilt plugin, which is `${CLAUDE_PLUGIN_ROOT}` in Claude Code, or otherwise a local clone of the unbuilt repository; `<instance-dir>` is the instance to check.

Add `--today YYYY-MM-DD` only when you are reproducing an evidence-date result.

If Node.js 22 or later is not available, clone the unbuilt repository and install Node.js 22 or later, then run the command. If you cannot, check the instance by hand against the rule table below and tell the user the result is unverified.

## Exit codes

The exit code is 0 when there are no errors, 1 when there is at least one error, and 2 for a usage problem or an internal failure. Warnings never fail CI.

## Report the findings

For each finding, say in one sentence what failed, then propose one concrete fix: the file, the line and the change. For `leak-*` findings, repeat only the masked match from the output, never the full value. Apply a fix only when the user asks you to; validating on its own never edits the instance. When there are no findings, say the instance passes format version 1.

## Rules

Severity is the default. A rule that emits both levels lists both.

| Rule | Checks | Severity |
|---|---|---|
| `required-files` | `README.md`, `unbuilt.yaml`, `SPEC.md`, `constraints.md` and `BUILD.md` exist at the root. | error |
| `module-files` | Each declared module directory has `problem.md`, `SPEC.md` and `scenarios.md`. | error |
| `yaml-parse` | `unbuilt.yaml` parses under the YAML subset of `FORMAT.md` section 10. | error |
| `yaml-fields` | Required fields are present and typed; `reference_impl` agrees with `origin`; `public_hosts` entries are well formed; unknown keys. | error, warning for unknown keys |
| `yaml-enums` | `origin`, `maturity`, `original_effort` and `interview` hold allowed values. | error |
| `module-ids` | Module IDs match `^[A-Z]{2,8}$`, are unique and are not `INV`. | error |
| `module-paths` | Module paths start with `modules/`, are unique and exist; directories under `modules/` that no module declares. | error, warning for undeclared |
| `id-format` | Declaration lines match the exact form and sit in the right `SPEC.md`. | error |
| `id-unique` | No ID is declared twice. | error |
| `id-retired-form` | Retired lines read `retired: reason` with no modality; no scenario cites a retired ID. | error |
| `scenario-cites-id` | Each scenario cites a declared, live ID; every cited ID is declared; empty scenario files. | error, warning for an empty file |
| `must-has-scenario` | Every live MUST is cited by a scenario. | error |
| `should-has-scenario` | Every live SHOULD is cited by a scenario. | warning |
| `substitution-files` | Each listed substitution has its file; the matrix file exists; names are kebab-case and unique; unlisted files. | error, warning for unlisted |
| `substitution-matrix` | The matrix has one column per substitution, one row per module ID, and only `required`, `optional` or `-` cells. | error |
| `evidence-dates` | Evidence file names, `Checked:` and `Expires:` lines and their order; expired evidence. | error, warning for expired |
| `redaction-required` | `redaction.md` exists for a private origin. | error |
| `design-required` | `design/README.md` exists when `has_ui` is true. | error |
| `leak-email` | Email addresses outside the example domains. | error |
| `leak-ipv4` | IPv4, IPv6 and MAC addresses outside the allowlists and the version exception. | error |
| `leak-hostname` | Hostnames under listed TLDs and every URL host that is not allowed. | error |
| `leak-home-path` | Home directory paths on macOS, Linux and Windows, and tilde-user paths. | error |
| `leak-secret` | Known secret shapes and generic credential assignments. | error |
| `budget-file-lines` | Each `.md` file has at most 1,500 lines; no text file is too large to scan. | error |
| `budget-total-words` | Total Markdown is at most 60,000 words. | error |
| `budget-image` | Each image is at most 2 MB and of type png, jpg, jpeg, webp or svg. | error |
| `budget-module-count` | At most 12 modules are declared. | error |
| `file-types` | Every entry is a regular, readable text file or an allowed image that parses; no `node_modules/`. | error |

## What is not checked

The validator does not check ticket keys, people's names, device names, account aliases, secrets without a known shape, hostnames under unlisted TLDs outside URLs, or the structure of `BUILD.md`. Ticket keys are not a rule because a ticket key is indistinguishable from a requirement ID by regex. The extract skill's human pass catches the leak categories. Do not tell the user a passing instance is free of them.
