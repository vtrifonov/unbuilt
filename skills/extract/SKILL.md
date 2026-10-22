---
name: extract
description: Extract an unbuilt instance from a working implementation, with an interview and a redaction gate. Use when asked to extract an unbuilt spec, turn this project into an unbuilt repo, or share this tool without the code.
---

You turn a working implementation into an unbuilt instance: a spec, substitution points, hindsight and ordered milestones that let someone else build their own version without seeing the code. You interview the author, draft the instance, run a redaction gate, validate the result and hand it over. You never publish anything.

## Inputs and outputs

- The input is `<source-dir>`, the path to a local checkout of the source implementation. Optionally the author names an existing instance to update instead of creating a new one.
- The output is an instance directory, `<output-dir>`. By default it is a sibling of the source checkout named `<name>-unbuilt`: a source at `/x/clipjar` gives `/x/clipjar-unbuilt`. You leave it validated and unpublished.
- You write only inside `<output-dir>`. You never create, change, move or delete anything in `<source-dir>`, and you never run a command there that writes.

The validator is run as:

```
node <unbuilt-root>/scripts/validate.mjs <output-dir> --json
```

`<unbuilt-root>` is the directory of the unbuilt plugin, which is `${CLAUDE_PLUGIN_ROOT}` in Claude Code, or otherwise a local clone of the unbuilt repository.

The validator needs Node.js 22 or later. If it cannot run, offer the user the manual rule check of the validate step (`/unbuilt:validate` or `prompts/validate.md`) and say that its result is unverified; if the user declines, stop.

Run the steps below in order. Each of steps 1 to 4 writes its results into the draft before the next step begins, so an interrupted run leaves a draft you can resume from. Step 5, the redaction gate, is the exception: it is never resumed and always runs in full.

## Step 1: Preflight

1. Check that `<source-dir>` exists and that you can read it. If it does not exist or is unreadable, stop and say so.
2. Ask the user for the instance `name` first, before resolving any output directory. It must be kebab-case: lowercase letters and digits separated by single hyphens, at most 64 characters. Propose `<name>-unbuilt`, next to the source checkout, as the default output directory, and let the user choose another.
3. Resolve the output directory to an absolute real path, following symbolic links. Resolve `<source-dir>` the same way. Refuse and stop when the output directory equals the source directory or lies anywhere inside it.
4. If the output directory exists, is non-empty and has no `unbuilt.yaml`, refuse and stop: it is neither empty nor an instance. If it has an `unbuilt.yaml`, switch to update mode (see "Update mode" below).
5. Ask the user whether the source is private.
   - Private: set `origin: extracted-from-private-implementation` and `reference_impl: private`.
   - Public: ask for the public `https://` URL of the source and set `origin: extracted-from-public-implementation` and `reference_impl` to that URL.
6. Tell the user the redaction defaults before going further. Everything `FORMAT.md` section 7 lists is always removed: configuration values, real hostnames, IPs, emails, people's names other than the author's chosen public handle, account aliases, device names, ticket or issue keys, home paths, internal URLs, secrets, and account-specific numbers such as quotas, prices or limits. Company and product names, including public platforms, languages and dependencies, are removed unless the author opts in per name at the redaction gate. Say also that this skill publishes nothing: it creates no repository, no remote, no commit and no push.

Write `unbuilt.yaml` with `unbuilt: 1`, `name`, `origin` and `reference_impl` as soon as these answers are in.

## Step 2: Inventory

1. Map the source with bounded reads only. Collect languages and their sizes, top-level directories, entry points, existing documentation, test directories and the names of configuration files.
2. Read any file over about 400 lines in ranges, never whole.
3. Read configuration files for structure only, such as which sections or keys exist. Never quote their values, in the conversation or in the draft.
4. Propose between 1 and 12 capabilities, typically 4 to 8. A capability is something a user of the tool would recognise, not a source folder. Give each a one-line purpose and its apparent maturity: `shipped`, `partial`, `sketched` or `abandoned`.
5. Ask the author to confirm, merge, split or rename the capabilities. If the author declines to confirm any module list, stop and say so.
6. The confirmed list becomes `modules` in `unbuilt.yaml`. Propose a module ID for each (two to eight uppercase letters, not `INV`, not a common acronym) and use only IDs the author approves. Each module gets a kebab-case directory under `modules/`.

## Step 3: Interview

For each capability, ask the author, one question at a time:

1. What problem does it remove, and what happens without it?
2. What must never change? Each answer becomes a MUST.
3. What would the author drop or relax? Each answer becomes a SHOULD, a MAY or an explicit exclusion.
4. What is specific to the author's environment? Each answer is a substitution candidate.
5. What did the author try that failed? Answers go into `known-failures.md`.

Then ask globally:

1. Invariants that must hold in every build, across modules.
2. Constraints: environment, platform, security and privacy rules that bound every build.
3. Hindsight: what the author would do differently, drop, or found slower than expected. Answers go into `retrospective.md`.
4. Implementation terms: anything the author wants builders to know or agree to, in one or two sentences.
5. Whether the tool has a user interface (`has_ui`).
6. The original effort: `S`, `M`, `L` or `XL`.

Write each answer into the draft as it arrives, not at the end.

## Step 4: Draft

1. Write every required file: `README.md`, `unbuilt.yaml`, `SPEC.md`, `constraints.md`, `BUILD.md`, and `problem.md`, `SPEC.md` and `scenarios.md` for each module. Write `redaction.md` in step 5. Write each optional file the interview populated: `substitutions/README.md` and one `substitutions/<point>.md` per substitution point, `known-failures.md`, `retrospective.md`, `decisions/`, `evidence/`.
2. Give requirements IDs in order of first mention: `<MOD>-1`, `<MOD>-2`, and so on per module, `INV-1` onwards for invariants in the root `SPEC.md`. Use the exact declaration form `- **CORE-1** (MUST) Text.`
3. Write scenarios from the source's existing tests where they exist, rewritten as behaviour in Given/When/Then lines. Never copy test code or test names that carry code. Where no test exists, write scenarios from the interview. Every MUST is cited by at least one scenario.
4. In `BUILD.md`, make milestone 1 the thinnest end-to-end slice a builder can see run. Order later milestones by dependency. Tell the author they may reorder them.
5. When `has_ui` is true, write `design/README.md` from the screens you find in the source: views, routes, menus. Give each screen its purpose, key elements and states (empty, loading, error). Add images only when the author supplies synthetic or redacted ones.
6. When a file would exceed a size budget, summarise its content instead of truncating it mid-section.

## Step 5: Redaction gate

This is the only defence against leaks the validator cannot see. Run all of it, in this order, every time. The gate is never resumed: every run, including a resumed run and update mode, starts at the mechanical pass and asks for the whole name list again. The only state the gate keeps between runs is the category lines of `redaction.md`, which hold no names. Their presence never allows you to skip any part of the gate.

### 5.1 Mechanical pass

1. Run the validator on the draft with `--json` and collect every finding whose rule starts with `leak-`.
2. Present each hit to the author with its file, its line and the masked match from the validator output. Never show or repeat the unmasked value.
3. For each hit the author either confirms a replacement or marks it safe.
   - A replacement is a role word in prose, such as "the primary account", "the phone" or "the work tracker".
   - Marking safe is offered only for `leak-hostname` and `leak-ipv4` hits that are public, such as a documentation site or a public resolver. Marking safe adds the host or IP to `public_hosts` in `unbuilt.yaml`. Show the author each entry before you write it.
   - Every other hit must be replaced: emails, home paths, secret shapes, and any host or IP that is not public.
4. Apply the replacements and re-run the validator until no `leak-*` finding remains.

### 5.2 Seed list

Before you ask the author for any names, build a candidate list from the source and show it:

- author and committer names and emails from `git log`;
- the names in co-author trailers in commit messages;
- the copyright holder in `LICENSE`;
- the `author` and similar fields (contributors, maintainers, publisher) of package manifests;
- the entries of `CODEOWNERS`;
- the bundle or reverse-DNS identifier prefix.

Search the draft for each candidate with the matching rules of section 5.4, unless the operator chooses to keep that candidate. Group its hits and decide them in bulk exactly as in section 5.4. Hold the list in the conversation only.

### 5.3 Host candidates

Search the draft for dotted tokens matching `\b[\w-]+(\.[\w-]+)+\b` whose last label is not in the validator's TLD list and is not a known file extension of the draft: `md`, `yaml`, `png`, `jpg`, `jpeg`, `webp`, `svg`, and the source's own file extensions. Present each distinct token with its context and ask whether it is a hostname. Replace a confirmed hostname with a role word, or, if it is public, add it to `public_hosts` after showing the entry. Bare hosts under `.local` and `.home`, such as `build-box.local` or `api.svc.cluster.local`, reach the author only through this search, because the validator lists neither TLD.

### 5.4 Name pass

Ask the author to name every company, product, person, team, account, device, ticket-key prefix, secret or credential, and internal hostname or URL that appears in the source. Ask for all of these categories even when the seed list looked complete.

Search the whole draft for each name, including every value in `unbuilt.yaml`, case-insensitively:

- A name of 4 or more characters is matched as a substring, not as a whole word. For "Acme" you find `AcmeSyncService`, `ACME_API_TOKEN` and `@acme/sdk`.
- A name of 1 to 3 characters is matched only at identifier boundaries: as a whole word, or as a segment of a camelCase, snake_case or kebab-case identifier, or of an `@scope/` package name. For "Ed" you find `Ed`, `EdClient`, `ed_token` and `@ed/sdk`, and not `edited` or `added`.

Group the hits by name. For each name, the author first decides in bulk: "replace all" with a role word, or "keep all". Then show the exceptions: each hit with its file, line and surrounding context. The author may flip any single hit.

In `unbuilt.yaml`, only the entries of `platforms` and `original_stack` are exempt from role words, and they are handled in section 5.5. `summary` and `implementation_terms` get role words like any prose. A hit in `name`, a module `id`, a module `path` or a `substitutions` name triggers a rename (section 5.6).

### 5.5 Company and product names

Company and product names are removed unless the author opts in per name. List every name in `platforms`, in `original_stack`, and in each substitution file's "what the original used", and ask about each one explicitly. Explain that declining makes the instance platform-blind: a builder's agent can no longer tell whether its environment differs from the original.

- A declined platform becomes a generic token in `platforms`: `desktop`, `server` or `mobile`.
- A declined `original_stack` entry is removed.
- A declined name anywhere else gets a role word.

Record the opt-ins only as a count per category in `redaction.md`, never by name.

### 5.6 Renames

When the author replaces a name found in an identifier-valued field of `unbuilt.yaml`, rename in one step:

- `name`: the author chooses a neutral kebab-case name. Write it, rename the output folder to `<new-name>-unbuilt`, and repeat the folder checks of step 1 on the new path: it must not equal or lie inside the source directory, and it must not be a non-empty directory without an `unbuilt.yaml`.
- A module `path`: rename the module directory and update the `path` value.
- A `substitutions` name: rename `substitutions/<name>.md`, and update the list entry and the matrix column in `substitutions/README.md`.
- A module `id`, on a first extraction: the author chooses a role-word ID that still matches `^[A-Z]{2,8}$`, such as `SYNC`. Rewrite every declaration and citation of that module's IDs and its matrix row. This is the only ID change you ever make.
- A module `id`, in update mode: never rename it. Show the hit and offer two choices. Either the author opts the name in, or you retire every requirement of that module with the retired form, for example `- **ACME-1** retired: module renamed for redaction`, and declare a new module with a neutral ID whose requirements get fresh numbers.

After any rename, re-run the validator and the whole name search of section 5.4 on the renamed draft.

Worked example, with invented names: the author extracts the private tool "AcmeSync" for the company "Acme" and declines both names. The draft has `name: acmesync`, `summary: Syncs Acme tickets to the work tracker.` and folder `acmesync-unbuilt`. The gate rewrites the summary as "Syncs tickets from the issue tracker to the work tracker.", the author picks `name: ticket-sync`, the folder becomes `ticket-sync-unbuilt`, and the re-run search finds no hit for either name.

### 5.7 What the gate keeps

- Names the author gives, and the seed list, are held in the conversation only. Never write them to any file, including `redaction.md`, and never echo them in the final summary.
- Write `redaction.md` after the name pass completes. It lists the categories removed, the replacement convention, the count of opted-in names per category, and the number of `public_hosts` entries, never the entries themselves. Write it always for a private origin. For a public origin, write it when anything was replaced or `public_hosts` is non-empty.
- Refuse to go on to step 6 while any confirmed leak remains. If the author refuses every replacement for a confirmed leak, stop and say so.

## Step 6: Validate and hand over

1. Run the validator. Fix every error and re-run until it exits 0. Report the warnings; you need not fix them.
2. Print the list of files the author must read by hand before publishing: `redaction.md`, `SPEC.md`, every `modules/*/SPEC.md`, and every image under `design/`.
3. Stop. Do not run `git init`, add a remote, commit, push or create a repository. Publishing is the author's action.

## What you never emit

- Code copied from the source tree, including single lines, signatures and test bodies.
- Any file copied verbatim.
- Configuration values.
- Secrets in any form.
- Real data rows.
- The author's home path, or their user name inside a path.
- Anything over the size budgets.

Invented examples, data shapes and CLI usage lines in fenced blocks are allowed. Say in the surrounding prose that they are invented.

## When the author is not available: `interview: none`

Use this mode when the author cannot answer the interview.

1. Set `interview: none`, or `interview: partial` when some answers were given. Derive modules, requirements, scenarios and constraints only from code, docs, tests, commit messages and public issues.
2. Mark every requirement whose MUST was inferred rather than confirmed with `(inferred)` right after the modality: `- **CORE-2** (MUST) (inferred) Text.` You may mark SHOULD and MAY requirements the same way.
3. Do not write `retrospective.md`; hindsight cannot be inferred. Write `known-failures.md` only from evidence in the source, such as docs, comments and issues, and say so in the file.
4. The preflight answers (name, output directory, origin) and the redaction gate still require the operator. The mechanical pass must end with zero `leak-*` findings. The operator performs the name pass without needing to know the names: show the seed list and the host candidates, and search each name with the matching, grouping and bulk decision of section 5.4.
5. Use the capability list without the author's confirmation. In the hand-over list, add that the author should review the module cuts and every `(inferred)` line.

## Update mode

When `<output-dir>` already holds an instance:

1. Keep every existing ID. New requirements get the next unused number in their module. A removed requirement becomes a `- **CORE-3** retired: <reason>` line. Never renumber anything.
2. Remove an `(inferred)` marker only when the author confirms that requirement.
3. Run the redaction gate in full, from the mechanical pass, and ask for the whole name list again.
4. Before validating, show the author a short list of the requirement IDs you added, changed or retired.

## Stop conditions

Stop, say why, and write nothing more when:

- the output directory is the source directory or lies inside the source tree;
- the output directory is non-empty and not an instance;
- the source directory does not exist or is unreadable;
- the author declines to confirm the module list in `author` or `partial` mode;
- a confirmed leak cannot be replaced because the author refuses every replacement;
- the validator cannot run and the author declines the manual rule check of the validate step (`/unbuilt:validate` or `prompts/validate.md`).
