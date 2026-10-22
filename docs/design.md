# Design

Conventions for every extension in `src/`. Behavior of one extension lives in
its module comments.

## Dependencies

- Import only Node built-ins and the packages pi supplies to extensions, as
  listed in pi's `docs/packages.md`.
- Declare those packages in `peerDependencies` with `*` and in `devDependencies`
  for type checking.
- Add another dependency only when it replaces logic that cannot stay simple. pi
  loads extensions through jiti on every start, so each one costs startup time.
- Rejected: `just-bash` for `auto`, because it covers Bash only and the
  allowlist needs no parser.

## Config

- Global file: `<agent-dir>/<file>.json`, from `getAgentDir()`. Each extension
  picks its file name, such as `auto-mode.json`.
- Project file: `<project>/.pi/<file>.json`, with a subset of fields.
- Schema: TypeBox in the extension's `config.ts`, with a `description` per field
  as the reference.
- Validation: `Value.Check`. An invalid file is ignored whole, and each
  `Value.Errors` entry becomes a warning naming the file. A missing file is
  fine.
- Defaults: one `defaultConfig`. A default that depends on runtime state stays
  optional and is documented in code.
- Reload: files are read on `session_start`, so `/reload` applies edits.
- Trust: pi does not gate extension files behind project trust, so a project
  schema for a security setting allows only fields that tighten it.

## State

- A switch command shows the status without arguments, and `on` or `off` sets
  it, as in `/auto` and `/fast`.
- pi replaces the extension runtime on `/new`, `/resume`, `/fork`, and
  `/reload`. State that must outlive a session lives on `globalThis` under a
  `Symbol.for("pi-tweaks.<extension>.<key>")` key, where `<extension>` is the
  directory name in `src/`.

## Testing

- Declare the narrow slice of pi's context an extension uses, such as
  `Readonly<Pick<ExtensionUIContext, "notify">>`, and pass plain objects for it
  in tests.
- Inject process-wide state, such as the `globalThis` store, so tests stay
  isolated.
