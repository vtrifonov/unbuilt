# unbuilt

A format and a set of agent skills for publishing software as a specification instead of as code.

## What an unbuilt repo is

An unbuilt repo is a public repository that holds the specification of a finished private implementation and nothing else. It describes the behaviour, the constraints, the scenarios that prove the behaviour, and the order to build it in. It holds no source code. Anyone can hand it to a coding agent and get a fresh build in the language and environment they choose. Make one when you want to share an idea, with credit, without sharing the code, or when you want the idea to outlive the stack it was first written in. The format is defined in `FORMAT.md`.

## The three verbs

**Extract** reads a source directory and writes an instance: the spec, the constraints, the scenarios and the build order. Requirements the skill infers from the code are marked `(inferred)` so a reader can tell them from decisions the author made. It also runs a redaction pass so names, hosts, paths and secrets stay out.

**Build** reads an instance and builds it into a project directory, one milestone at a time, following `BUILD.md`. It records where the build departs from the spec and why.

**Validate** checks an instance against the format: required files, the YAML subset, requirement IDs, modality, size budgets and the mechanical part of redaction. It reads files and prints findings. It never writes and never uses the network.

## Install

Claude Code:

```
claude plugin marketplace add vtrifonov/unbuilt
claude plugin install unbuilt@unbuilt
```

The skills are invoked as `/unbuilt:extract`, `/unbuilt:build` and `/unbuilt:validate`.

Other agents: paste `prompts/extract.md`, `prompts/build.md` or `prompts/validate.md` into the agent and replace the placeholders in angle brackets, such as the instance directory and the path to this repository, with real paths.

## Quick start

Requires Node 22 or later. There is nothing to install.

Validate the example:

```
node scripts/validate.mjs examples/clipjar
```

Build the example: run `/unbuilt:build` on `examples/clipjar`, or paste `prompts/build.md` and give it that directory and an empty project directory.

Extract your own: run `/unbuilt:extract` on your project directory and choose an output directory. Then run `node scripts/validate.mjs <output-dir>` until it prints `ok`.

## The example

`examples/clipjar/` is an instance extracted from Clipjar, a small macOS clipboard history app. The original is public at https://github.com/vtrifonov/clipjar. It was chosen because readers can compare the spec to the code and see what the extraction kept and what it left out. The `template/` directory is an empty instance to start from.

## Prior art and positioning

Spec-driven tools (GitHub Spec Kit, Kiro, OpenSpec, BMAD, Tessl) turn a spec into code inside one project. ADRs record decisions. RFC 2119 gives MUST, SHOULD and MAY. test262 and WPT are conformance suites for one standard with many implementations.

unbuilt sits elsewhere. The spec is extracted from a finished private implementation and is the only public artefact. It is built many times in different environments, with no claim of conformance. Publishing an unbuilt repo is also a defensive publication: the idea is public, dated and attributed.

## FAQ

**Why not just share the code?** Sometimes the code cannot be shared: it holds private history, depends on private services, or belongs to an employer. Sometimes the code is the wrong thing to share, because it is tied to one language and one era. A spec carries the idea and leaves the choices to the builder.

**What does a builder get?** A statement of what the software must do, the limits it works within, scenarios that show the behaviour, and a milestone order. The builder does not get the original code, and two builds will differ. The format promises a spec to build from, not an identical result.

**Who owns an instance's license?** The instance author. The license of the original software is a separate matter, and an instance states it in its README.

**Is publishing an instance a defensive publication?** Yes. It makes the idea public with a date and an author, which can later count as prior art.

**Why is there no conformance testing?** Builds are expected to differ. The scenarios say what to check, but nothing here certifies that a build matches the spec.

## Discovery

Tag instance repositories with the GitHub topic `unbuilt`. The suggested repository name is `<name>-unbuilt`.

## License

MIT. See `LICENSE`. An instance carries its own license, chosen by its author.
