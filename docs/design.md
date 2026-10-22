# Design

These conventions apply to every extension in `src/`. Behavior that belongs to
one extension lives in that extension's module comments.

## Dependencies

Extensions import only Node built-ins and the packages pi supplies to
extensions, which pi's `docs/packages.md` lists. Those packages go in both
`peerDependencies` with a `*` range and `devDependencies` for local type
checking. pi loads extensions through jiti on every start, so each extra runtime
dependency adds startup time and an install step for users.

A larger dependency has to replace logic the extension cannot keep simple. For
example, the `auto` extension rejects shell parsers such as `just-bash`, because
its allowlist only needs to detect operators and quotes, and a parser would
cover Bash but not PowerShell.

## Config

An extension that needs settings reads its own JSON file instead of pi's
`settings.json`:

```text
<agent-dir>/<name>.json          global, every field
<project>/.pi/<name>.json        project, a subset of fields
```

- `<agent-dir>` comes from `getAgentDir()`, which honors `PI_CODING_AGENT_DIR`.
- The TypeBox schema in the extension's `config.ts` is the reference for its
  fields, with a `description` on each one.
- `Value.Check` validates each file. A file that fails is ignored as a whole,
  and pi shows each `Value.Errors` entry as a warning that names the file. A
  missing file is not an error.
- Defaults live in one `defaultConfig` object. A field whose default depends on
  runtime state stays optional, and the code documents the rule.
- Files are read on `session_start`, so `/reload` applies an edit.

pi's `settings.json` merges project values over global ones. A separate project
file is also read without project trust, because pi gates only its own `.pi`
resources. The project schema of a security setting therefore allows only fields
that tighten it.

## Commands

A command that switches an extension, such as `/auto` or `/fast`, shows the
status when called without arguments, and `on` or `off` sets the state. pi
replaces the extension runtime on `/new`, `/resume`, `/fork`, and `/reload`, so
state that must outlive a session lives on `globalThis` under a `Symbol.for`
key.

## Testing

Each extension declares the narrow slice of pi's context it uses, such as
`Readonly<Pick<ExtensionUIContext, "notify">>`. Tests pass plain objects for
that slice instead of starting pi.
