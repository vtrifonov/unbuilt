# unbuilt format

Version: 1

## 1. What an unbuilt repo is

An unbuilt instance is a directory with `unbuilt.yaml` at its root. It holds a spec, the substitution points, the author's hindsight and ordered milestones for software that is shared without its build. A reader's agent turns it into a new implementation in the reader's own environment. Three verbs work on an instance:

- **extract**: turn a working implementation into an instance.
- **build**: turn an instance into a new implementation in the builder's environment.
- **validate**: check an instance against this contract.

Builds are expected to differ. No conformance is claimed.

## 2. Version

Instances declare `unbuilt: 1` in `unbuilt.yaml`. Format versions are integers.

The version is bumped when a required file or a required `unbuilt.yaml` field is added or removed, when a validator rule becomes stricter (a new error, a warning promoted to error, a tighter budget), or when an ID or modality rule changes meaning. It is not bumped for new optional files or fields, new warnings, prose clarifications, or new skills or skill behaviour.

A validator supports exactly one format version. On any other value it reports `format version M is not supported by this validator (supports 1); see CHANGELOG.md` and checks nothing else. The plugin version in `plugin.json` is semver and independent of the format version.

## 3. Required files

File names are case-sensitive. Modules are one directory per user-facing capability, never per source folder. Module directories live under `modules/`; the directory name is kebab-case and need not equal the module ID.

| File | Content contract | Rule |
|---|---|---|
| `README.md` | What it is (one paragraph); who it is for (one paragraph); how to build it, pointing at the `/unbuilt:build` skill and the plain prompt `prompts/build.md` in the unbuilt repo; the author's `implementation_terms` restated in prose, or "No terms." when the field is absent. | `required-files` |
| `unbuilt.yaml` | Metadata, schema below. | `required-files` |
| `SPEC.md` | Product goal (one paragraph); glossary; invariants with `INV-<n>` IDs (what must hold in every build across modules); explicit exclusions (what this is not). | `required-files` |
| `constraints.md` | Environment, platform, security and privacy MUSTs that bound every build. Bulleted, one constraint per bullet, each containing MUST, SHOULD or MAY. No IDs. | `required-files` |
| `BUILD.md` | Ordered milestones, form below. | `required-files` |
| `modules/<capability>/problem.md` | The pain the capability removes and what happens without it. | `module-files` |
| `modules/<capability>/SPEC.md` | Requirements in the line form of section 5. | `module-files` |
| `modules/<capability>/scenarios.md` | Given/When/Then scenarios citing requirement IDs. | `module-files` |
| `redaction.md` | Required when `origin: extracted-from-private-implementation`. Categories removed and the replacement convention. Never lists removed values. | `redaction-required` |
| `design/README.md` | Required when `has_ui: true`. One entry per screen or surface with purpose, key elements and states (empty, loading, error). Images optional, synthetic or redacted. | `design-required` |

**Milestones.** Each milestone in `BUILD.md` is a level-2 heading `## Milestone <n>: <name>`, with `n` counting from 1 without gaps, followed by these lines in any order:

- `Covers:` comma-separated requirement IDs, optionally with module IDs in parentheses.
- `Done when:` one observable outcome a builder can check by running the build.
- `Effort:` `S`, `M` or `L`, relative to the author's build.

Milestone 1 is a thin end-to-end slice the builder can see run. Later milestones follow dependency order; the author may reorder. The structure of `BUILD.md` is read by the build skill and is not machine-checked in format version 1.

**Scenarios.** A scenario is a level-2 section (`## <title>` up to the next `## ` heading or end of file) in a module's `scenarios.md`. Text before the first `## ` heading is not a scenario. Each scenario cites at least one declared, non-retired requirement ID anywhere in its section; the recommended form is a line `Covers: CORE-1, INV-2` (`scenario-cites-id`). Write `Given`, `When` and `Then` lines that describe behaviour, not code. A scenario may cite other modules' IDs and invariants.

**`unbuilt.yaml`.** Written in the YAML subset of section 10. Field order is free.

| Field | Type | Required | Values and default |
|---|---|---|---|
| `unbuilt` | integer | yes | Must be `1`. |
| `name` | string | yes | Kebab-case `^[a-z0-9]+(-[a-z0-9]+)*$`, at most 64 characters. The instance repo name without the `-unbuilt` suffix. |
| `summary` | string | yes | One sentence, 1 to 200 characters. |
| `origin` | enum | yes | `extracted-from-public-implementation`, `extracted-from-private-implementation`, `designed-not-built`. |
| `reference_impl` | string | yes | An `https://` URL for a public origin, the literal `private` for a private origin, the literal `none` for `designed-not-built`. |
| `license` | string | yes | License of this instance repo, an SPDX identifier such as `MIT`. Non-empty, no spaces. |
| `has_ui` | boolean | yes | `true` or `false`. |
| `platforms` | list of strings | yes | Non-empty, each `^[a-z0-9][a-z0-9-]*$` (`macos`, `linux`, `web`). A declined platform becomes `desktop`, `server` or `mobile`. |
| `original_stack` | list of strings | no | Default empty. Effort signal only. |
| `original_effort` | enum | no | `S`, `M`, `L`, `XL`. Default absent. |
| `interview` | enum | no | `author`, `partial`, `none`. Default `author`. |
| `implementation_terms` | string | no | Default absent. The author's terms for builders, one or two sentences. |
| `modules` | list of maps | yes | Non-empty, at most 12 (`budget-module-count`). Each map has `id`, `path` and `maturity`, all required. |
| `substitutions` | list of strings | no | Default empty. Each kebab-case and unique; each names `substitutions/<name>.md`. |
| `public_hosts` | list of strings | no | Default empty. Public hosts or IP literals the author confirmed at the redaction gate. |

- Missing or mistyped fields, and a `reference_impl` that disagrees with `origin`, are `yaml-fields` errors. Unknown keys are `yaml-fields` warnings, so newer optional fields degrade gracefully. A file the subset cannot parse is a `yaml-parse` error.
- Enum values outside the sets above are `yaml-enums` errors. Matching is case-sensitive. A module `maturity` is `shipped`, `partial`, `sketched` or `abandoned`.
- A module `id` matches `^[A-Z]{2,8}$`, is unique and is not `INV` (`module-ids`). Choose IDs that are not common acronyms: `UTF` would turn the text `UTF-8` into a citation.
- A module `path` starts with `modules/`, has no `..` segment, is unique and names an existing directory. A directory directly under `modules/` that no module declares is a warning (`module-paths`).
- Each `public_hosts` entry is unique and is a lowercase hostname matching `^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$` or an IPv4 or IPv6 literal; any other entry is a `yaml-fields` error. Entries match exactly, never as a parent of subdomains.

## 4. Optional files

The validator checks the shape of these only when they are present.

| File | Contract | Rule |
|---|---|---|
| `substitutions/README.md` | Matrix as a Markdown table. The header row is `Module` followed by one column per substitution name; one row per module ID; cells are `required`, `optional` or `-`. Required when `substitutions` is non-empty. | `substitution-files`, `substitution-matrix` |
| `substitutions/<point>.md` | What the original used; what any replacement must provide (prose, optionally an invented example); known alternatives; how to tell the replacement is right. | `substitution-files` |
| `decisions/<slug>.md` | Short ADR-shaped principle with a rationale that outlives the original build. | none |
| `evidence/<YYYY-MM-DD>-<slug>.md` | Dated finding about a tool, API or platform. Starts with `Checked: YYYY-MM-DD` and `Expires: YYYY-MM-DD` lines. Builders re-check anything past expiry. | `evidence-dates` |
| `known-failures.md` | What the author tried that did not work, and why. | none |
| `retrospective.md` | Hindsight: what the author would do differently, drop, or found slower than expected. | none |
| `implementations.md` | Reserved name, added only after a second build exists. Nothing more is specified. | none |

The `Checked:` and `Expires:` lines are the first two non-blank lines of an evidence file after an optional level-1 heading, in either order.
## 5. Requirement IDs

An ID is `<MOD>-<n>`. `MOD` is the declaring module's `id` from `unbuilt.yaml`, or `INV` for invariants in the root `SPEC.md`. `n` is a positive integer without leading zeros.

A requirement is declared by a line of exactly this form, in the module's `SPEC.md` or the root `SPEC.md` for `INV`:

```
- **CORE-1** (MUST) Text of the requirement.
```

The regex is `^- \*\*([A-Z]{2,8})-([1-9][0-9]*)\*\* \((MUST|SHOULD|MAY)\) (\S.*)$`. A near-miss, or a declaration in the wrong file, is an `id-format` error. IDs are unique across the instance (`id-unique`).

A retired requirement keeps its line as `- **CORE-3** retired: <reason>`, regex `^- \*\*([A-Z]{2,8})-([1-9][0-9]*)\*\* retired: (\S.*)$`. Retired IDs are exempt from coverage and must not be cited; a malformed retired line or a citation of one is an `id-retired-form` error.

IDs are stable: never renumbered, never reused. The validator cannot check history, so the extract skill enforces this when it updates an instance.

Every MUST, in a module or an invariant, is cited by at least one scenario in some module's `scenarios.md` (`must-has-scenario`). A SHOULD without a scenario is a warning (`should-has-scenario`). A scenario that cites an undeclared ID is a `scenario-cites-id` error.

A requirement derived without the author's confirmation carries `(inferred)` right after the modality: `- **CORE-2** (MUST) (inferred) Text.`

Declarations and citations inside fenced code blocks and HTML comments are ignored. Leak scanning still covers them.

## 6. Modality

RFC 2119 keywords, uppercase:

- **MUST**: a build without it is not this product.
- **SHOULD**: the author would notice its absence.
- **MAY**: nice to have.

## 7. Redaction rules

No code is copied from the source implementation, in any instance, including public-source instances. Invented examples, data shapes and CLI usage lines in fenced blocks are allowed.

Always removed: configuration values, real hostnames, IPs, emails, people's names (other than the author's chosen public handle), account aliases, device names, ticket or issue keys, home paths, internal URLs, secrets, and account-specific numbers.

Company and product names are removed by default; the author opts in per name at the extract skill's redaction gate. Public platforms, languages and dependencies count as product names. Replacements are role words in prose, such as "the primary account" or "the work tracker". `redaction.md` lists categories and the convention, never values.

**What the validator scans.** The mechanical subset: emails (`leak-email`), IPv4 and IPv6 addresses (`leak-ipv4`), hostnames and URL hosts (`leak-hostname`), home paths (`leak-home-path`), secret shapes (`leak-secret`), and files it cannot scan (`file-types`). Ticket keys, names, devices, accounts, secrets without a known shape, and bare hostnames under unlisted TLDs are left to the extract skill's human pass. A ticket key is indistinguishable from a requirement ID by regex, so it is not a rule.

**Declined names in `unbuilt.yaml`.** Only `platforms` and `original_stack` entries are exempt from role words. A declined platform becomes `desktop`, `server` or `mobile`; a declined stack entry is dropped. This makes the instance platform-blind, and a builder's agent cannot tell whether its environment differs from the original. Every other value is redacted:

- `summary` and `implementation_terms` get role words like any prose.
- A module `id` gets a role-word ID that still matches `^[A-Z]{2,8}$`, such as `SYNC`; every declaration, citation and matrix row is renamed with it.
- `name`, a module `path` and a `substitutions` name get a neutral kebab-case name; the folder, directory, file and matrix column are renamed with it.

**Exemptions and their limits.**

- `public_hosts` entries are matched exactly.
- A dotted quad preceded by `v`, by `version` with an optional quote, `:` or `=`, by `section ` or by `§` is a version or section number, not an address.
- A URL's host is checked whatever its TLD, so a URL naming a bare internal host and a port is a finding.
- A web route whose path starts with a `home` segment followed by a page name is a true positive for `leak-home-path`. Reword it, for example as "the settings route".

**File types.** Every file is a regular file, either text or an image of an allowed type (section 8); an `.svg` must be a text file. Symbolic links, other binaries, unreadable files and `node_modules/` are not allowed, because the validator cannot scan them (`file-types`).

## 8. Size budgets

All budgets are errors:

| Limit | Rule |
|---|---|
| Any single `.md` file: at most 1,500 lines | `budget-file-lines` |
| Total Markdown: at most 60,000 words | `budget-total-words` |
| Each image: at most 2 MB (2,097,152 bytes), type `png`, `jpg`, `jpeg`, `webp` or `svg` | `budget-image` |
| Modules: at most 12 | `budget-module-count` |

Line count is the number of `\n` characters, plus one if the file is non-empty and lacks a final `\n`. Word count is the number of non-empty tokens after splitting each `.md` file's full text, comments and fences included, on whitespace. The budgets exist because an earlier roadmap of the author's reached 103k words and became unreadable.

## 9. What builders are promised

An instance that passes the validator (`/unbuilt:validate`) has every required file, every MUST covered by a scenario, no mechanically detectable leak, and fits the budgets.

## 10. The YAML subset

`unbuilt.yaml` uses a small subset of YAML. A file valid under the subset is valid YAML with the same meaning for every other tool. Violations are `yaml-parse` errors with a line number.

**Accepted.** UTF-8 with an optional BOM, `\n` or `\r\n` line endings, spaces for indentation. Six line kinds:

1. A blank or comment line (`#` after optional spaces).
2. A top-level scalar `key: scalar` at column 0. Keys match `^[a-z_][a-z0-9_]*$`.
3. A top-level list head `key:` followed by list items.
4. A list item `- scalar`, indented 0 or 2 spaces, the same for every item of one list.
5. A map item start `- key: scalar`, opening a flat map.
6. A map continuation `key: scalar`, indented to the column after `- `.

The colon is followed by exactly one space. Scalars are bare, double-quoted (escapes `\"` and `\\` only) or single-quoted (`''` is a literal quote). A comment starts at a `#` preceded by a space and outside quotes. Bare `true` and `false` are booleans, a canonical integer (`^-?(0|[1-9][0-9]*)$`) is an integer, everything else is a string.

**Rejected,** with an error naming the feature:

- document markers (`---`, `...`), directives, anchors, aliases and tags;
- flow collections (a value starting with `[` or `{`) and block scalars (`|` or `>`);
- nesting deeper than a list of flat maps, including a map value that is a list;
- empty values and nulls (`key:` with nothing following, `null`, `~`);
- bare scalars another YAML reader would type differently: `yes`, `on`, `1.0`, `007`, `1:20`, dates; quote the value to keep a string;
- bare scalars that start with an indicator character, contain `: ` or end in `:`;
- duplicate keys at the same level.

Example:

```
unbuilt: 1
name: my-idea
summary: "Captures notes: one keystroke each."
has_ui: true
platforms:
  - desktop
modules:
  - id: CORE
    path: modules/core
    maturity: shipped
```
