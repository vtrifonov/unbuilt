# unbuilt

Publish software as a specification instead of as code. Anyone can hand the spec to a coding agent and get a fresh build in their own language and environment.

[![ci](https://github.com/vtrifonov/unbuilt/actions/workflows/ci.yml/badge.svg)](https://github.com/vtrifonov/unbuilt/actions/workflows/ci.yml)
[![format 1](https://img.shields.io/badge/format-1-informational)](FORMAT.md)
[![node >=22](https://img.shields.io/badge/node-%3E%3D22-brightgreen)](package.json)
[![zero dependencies](https://img.shields.io/badge/dependencies-0-success)](package.json)
[![MIT](https://img.shields.io/badge/license-MIT-blue)](LICENSE)

![validator demo](.github/demo.gif)

## What an unbuilt repo is

An unbuilt repo is a public repository that holds the specification of a finished private implementation and nothing else: the behaviour, the constraints, the scenarios that prove the behaviour, and the order to build it in. It holds no source code. Make one when you want to share an idea, with credit, without sharing the code, or when you want the idea to outlive the stack it was first written in.

Coding agents can now rebuild working software from a precise description. unbuilt is that description: small enough to read in an afternoon, strict enough to build from, and checked by a validator so the author cannot leak what they meant to keep.

This repository holds the contract ([FORMAT.md](FORMAT.md)), the validator, a template, a worked example and the agent skills.

```
my-tool-unbuilt/
  unbuilt.yaml          name, origin, license, platforms, modules
  README.md             what it is, who it is for, the author's terms
  SPEC.md               goal, glossary, invariants, exclusions
  constraints.md        platform, security and privacy MUSTs
  BUILD.md              ordered milestones, each with a "done when"
  modules/<capability>/
    problem.md          the pain it removes
    SPEC.md             requirements with stable IDs
    scenarios.md        Given/When/Then, citing requirement IDs
  substitutions/        choices left to the builder
  design/README.md      one entry per screen, with states
  evidence/             dated platform findings, with expiry
  known-failures.md     what the author tried that failed
```

## The three verbs

| Verb | Reads | Writes | What it does |
|---|---|---|---|
| **extract** | a source directory | an instance | Writes the spec, constraints, scenarios and build order. Marks requirements inferred from the code `(inferred)`. Runs a redaction pass with a gate where you opt in, per name, to anything that stays. |
| **build** | an instance | a project directory | Builds one milestone at a time following `BUILD.md`, in the language and environment you choose. Records where it departs from the spec and why. |
| **validate** | an instance | findings on stdout | Checks the instance against `FORMAT.md`: required files, YAML, requirement IDs, modality, scenario coverage, budgets and mechanical redaction. Never writes, never uses the network. |

Extract and build are agent skills. Validate is also a script that runs in CI.

```mermaid
flowchart LR
    A[private implementation] -->|extract + redaction gate| B[(instance: public repo)]
    B -->|validate| B
    B -->|build| C[Swift build]
    B -->|build| D[Rust build]
    B -->|build| E[web build]
```

One instance, many builds. The code never leaves; builders pick their stacks and tailor the behaviour.

## How this differs from spec-driven development

Spec-driven tools (GitHub Spec Kit, Kiro, OpenSpec, BMAD, Tessl) turn a spec into code inside one project; the spec is a step on the way to the code. test262 and WPT are conformance suites for one standard with many implementations.

unbuilt sits elsewhere. The spec is extracted from a finished implementation and is the only public artefact. It is built many times in different environments, with no claim of conformance. Publishing one is also a defensive publication: the idea is public, dated and attributed.

## Install

Claude Code:

```sh
claude plugin marketplace add vtrifonov/unbuilt
claude plugin install unbuilt@unbuilt
```

The skills are then `/unbuilt:extract`, `/unbuilt:build` and `/unbuilt:validate`.

Any other agent (Codex, Cursor, Gemini CLI, Copilot, Aider): paste [`prompts/extract.md`](prompts/extract.md), [`prompts/build.md`](prompts/build.md) or [`prompts/validate.md`](prompts/validate.md) into the agent and replace the placeholders in angle brackets with real paths. The prompts are generated from the skills, or reference them from `AGENTS.md`, `.cursor/rules` or `GEMINI.md`.

## Instances

Published unbuilt repos, newest first. Add yours with a pull request; the only requirements are the `unbuilt` topic and a passing validator.

| Instance | What it is | Origin |
|---|---|---|
| [clipjar-unbuilt](examples/clipjar/) | macOS clipboard history app | extracted from [vtrifonov/clipjar](https://github.com/vtrifonov/clipjar) |

Browse all repos tagged [`unbuilt`](https://github.com/topics/unbuilt).

## Quick start

Requires Node 22 or later. The validator has no dependencies.

```sh
git clone https://github.com/vtrifonov/unbuilt
cd unbuilt
node scripts/validate.mjs examples/clipjar
```

```
ok: clipjar passes unbuilt format 1
```

- **Build the example:** run `/unbuilt:build` on `examples/clipjar` with an empty project directory.
- **Extract your own:** run `/unbuilt:extract` on your project, answer the redaction gate, then run `node scripts/validate.mjs <output-dir>` until it prints `ok`.
- **Start from scratch:** copy `template/`. It already passes the validator.
- **Update after a code change:** run `/unbuilt:extract <source-dir> <instance-dir> since <tag>`. It reads only what changed and keeps requirement IDs stable.
- **Update a build:** run `/unbuilt:build <instance-dir>` again in your project; it reports what changed.

## The example

[`examples/clipjar/`](examples/clipjar/) is extracted from a small macOS clipboard history app whose original is public at https://github.com/vtrifonov/clipjar, so a reader can compare the spec to the code and see what extraction kept and left out.

Requirements are one line each, with an ID, a modality and a mark when the author inferred it rather than decided it:

```markdown
- **CAPTURE-3** (MUST) (inferred) A copy the source app marks as concealed, transient
  or auto-generated, or that carries a known password-manager marker, is skipped,
  decided from type metadata before any content is read.
```

Scenarios cite what they prove:

```markdown
## Secrets are not captured

Covers: CAPTURE-3
Given a password manager copies a password marked concealed
When the tool checks the clipboard
Then no clip is created and the content is never read.
```

Milestones in `BUILD.md` give an order, the requirements each one covers and a "done when" check.

## The validator

```
usage: node scripts/validate.mjs <instance-dir> [--json] [--today YYYY-MM-DD]
```

Exit codes: 0 passes, 1 has errors, 2 could not read the directory. Warnings do not fail the run. A failing run:

```
error    leak-email         modules/paste/problem.md:9  email address op… found; replace it with a role word (FORMAT.md §7)
warning  should-has-scenario  modules/capture/SPEC.md:10  CAPTURE-8 is a SHOULD but no scenario cites it (FORMAT.md §5)
1 error(s), 1 warning(s)
```

Every finding names its rule, location and defining `FORMAT.md` section. Leaked values are masked, so the report is safe to paste.

The 28 rules cover structure, requirement IDs, modality, budgets and leak shapes: emails, IPs, hostnames, home paths, secrets.

## Redaction: what is promised and what is not

The validator catches **mechanical** leaks: anything with a recognisable shape. It does not know that "the Berlin office" is private, and it cannot tell a person's name from a role word. That part is the extract skill's human pass and its redaction gate, where company and product names are removed by default and you opt in per name to each one that stays.

A passing instance is not yet safe to publish. Read it once as a stranger would before you push.

## FAQ

**Why not just share the code?** Sometimes it cannot be shared: private history, private services, an employer's property. Sometimes it is the wrong thing to share, tied to one language and one era. A spec carries the idea and leaves the choices to the builder.

**What does a builder get?** What the software must do, the limits it works within, scenarios that show the behaviour, substitution points where the choice is theirs, and a milestone order. Not the original code, and two builds will differ. The format promises a spec to build from, not an identical result.

**Can I change what I build?** Yes. Drop a module, change a behaviour to suit you, or add your own. The build records each change as a departure in `PLAN.md`, and the author's later updates keep it unless you say otherwise.

**Can I write an instance for software that was never built?** Yes. Set `origin: designed-not-built`. The format is the same.

## Discovery

Name the repository `<name>-unbuilt` and tag it with the GitHub topic `unbuilt`. Put your terms for builders in `implementation_terms`; the instance README restates them.

Run the validator in CI with the bundled action:

```yaml
on: [push, pull_request]
permissions:
  contents: read
jobs:
  validate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: vtrifonov/unbuilt@v0.1.0
```

It fails on any error. Pass `with: { instance: <dir> }` when the instance is not at the root.

## Versioning

The format and the plugin are versioned separately in [CHANGELOG.md](CHANGELOG.md). Format versions are integers, declared as `unbuilt: 1` in every instance, and bump only when a required file, a rule's strictness or an ID or modality rule changes meaning; a validator supports exactly one. Plugin versions follow semver.

## Contributing

```sh
npm test                                  # validator, skill and prompt tests
node scripts/validate.mjs template        # the template must stay valid
node scripts/validate.mjs examples/clipjar
```

Open an issue before proposing a change to `FORMAT.md`: a stricter rule is a format version bump and affects every published instance. Validator fixes and skill improvements are welcome as pull requests with a test. Edit skills, not prompts; the parity test tells you when to regenerate `prompts/`.

## License

MIT. See [LICENSE](LICENSE). An instance carries its own license, chosen by its author.
