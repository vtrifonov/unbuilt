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

The exit code is 0 when there are no errors, 1 when there is at least one error, and 2 for a usage problem, an instance directory that cannot be read or searched, or an internal failure. Warnings never fail CI.

## Report the findings

For each finding, say in one sentence what failed, then propose one concrete fix: the file, the line and the change. For `leak-*` findings, repeat only the masked match and the masked file path from the output, never the full value. Apply a fix only when the user asks you to; validating on its own never edits the instance. When there are no findings, say the instance passes format version 1.

## Rules

Severity is the default. A rule that emits both levels lists both.

The walk skips any entry named `.git`, file or directory. The `leak-*` rules scan every text file, every file and directory path relative to the instance root, and the metadata of every image, including a base64 png, jpeg or webp `data:` URI inside a text file. A path hit has no line. Each finding masks the match and masks its `file` column per path segment. Each rule lists at most 100 hits per pattern per file and 10,000 per run; past a cap, one `N more matches not listed` finding per file counts the rest.

| Rule | Checks | Severity |
|---|---|---|
| `required-files` | `README.md`, `unbuilt.yaml`, `SPEC.md`, `constraints.md` and `BUILD.md` exist at the root. | error |
| `module-files` | Each declared module directory has `problem.md`, `SPEC.md` and `scenarios.md`. | error |
| `yaml-parse` | `unbuilt.yaml` parses under the YAML subset of `FORMAT.md` section 10; no line holds U+0085, U+2028, U+2029, a non-leading BOM or a control character other than tab. | error |
| `yaml-fields` | Required fields are present and typed; `reference_impl` agrees with `origin`; `public_hosts` entries follow the grammar of `FORMAT.md` section 3; unknown keys. | error, warning for unknown keys |
| `yaml-enums` | `origin`, `maturity`, `original_effort` and `interview` hold allowed values. | error |
| `module-ids` | Module IDs match `^[A-Z]{2,8}$`, are unique and are not `INV`. | error |
| `module-paths` | Module paths are `modules/` plus one kebab-case directory name, are unique and exist; directories under `modules/` that no module declares. | error, warning for undeclared |
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
| `leak-hostname` | Hostnames under listed TLDs and every URL host that is not allowed, compared after stripping trailing punctuation and in punycode as well as raw form. | error |
| `leak-home-path` | Home directory paths on macOS, Linux and Windows, tilde-user paths, and a `Users/<name>` or `home/<name>` directory chain in the instance. | error |
| `leak-secret` | Known secret shapes; credential assignments whose key ends in a credential noun such as password, secret, token or api key; `Bearer` values after `Authorization:`, a quote or a backtick, or with a digit and a letter in each half. | error |
| `budget-file-lines` | Each `.md` file has at most 1,500 lines; no text file is too large to scan. | error |
| `budget-total-words` | Total Markdown is at most 60,000 words. | error |
| `budget-image` | Each image is at most 2 MB and of type png, jpg, jpeg, webp or svg. An image over the limit is not parsed, nor are the embeds of such an `.svg`. | error |
| `budget-module-count` | At most 12 modules are declared. | error |
| `file-types` | Every entry is a regular, readable text file or an allowed image that parses; an `.svg` must be a text file; a `data:image/` URI is a base64 png, jpeg or webp; image metadata inflates to at most 1 MiB per image or embed and 8 MiB per run; no `node_modules/`. | error |

## What is not checked

The validator does not check ticket keys, people's names, device names, account aliases, secrets without a known shape, hostnames under unlisted TLDs outside URLs, or the structure of `BUILD.md`. Ticket keys are not a rule because a ticket key is indistinguishable from a requirement ID by regex. The extract skill's human pass catches the leak categories. Do not tell the user a passing instance is free of them.
