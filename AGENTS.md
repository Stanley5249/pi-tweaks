# pi-tweaks

Private Pi customization project. Break cleanly rather than preserving
compatibility for unpublished interfaces.

## Scope

Keep context, scroll-speed, and status-line implementations independent. Expose
each feature through an explicit Pi extension entry when implemented; do not let
package discovery load internal helpers as extensions. Only extract shared code
after a second caller exists.

Keep extension behavior separate from terminal rendering. Guard TUI-only
behavior and clean up session resources on shutdown and reload. Pi supplies its
own host packages: declare those as peers rather than runtime dependencies, and
do not bundle them.

## Toolchain

Use Bun and the justfile. Keep command definitions out of package.json. Change
dependencies with `bun add` and `bun remove`; keep tooling versions exact and
commit the lockfile.

Oxc owns lint, type checking, and formatting. Do not add ESLint or Prettier. The
config files are the source of truth for individual rules. Do not enable nursery
rules or weaken pedantic checks merely to silence errors. Restriction rules
require a concrete project reason.

Run `just fmt` and `just check` before each commit. Run `just ci` after
completing the work. Keep tests as strict as other code; do not introduce
blanket test-file exemptions. The toolchain tests must continue to reject unsafe
promises and compiler errors.

## Rule choices

- Permit Node builtins because Pi runs extensions in a Node-compatible host.
- Permit named exports for internal modules and default exports for Pi entries;
  neither export form should be imposed on every module.
- Keep one variable per declaration and named function declarations, while
  allowing arrow callbacks.
- Check imported member ordering without imposing a second declaration sorter.
- Require async declarations for promise-returning functions, but not an await
  in every implementation of an asynchronous contract.
- Permit numeric template interpolation and concise void-returning callbacks,
  matching the existing Trove conventions.

## Editor and Git

Track .zed/settings.json intentionally so Oxc formatting is consistent. Retain
the TypeScript LSP for semantic editor features. Do not modify global editor or
Pi settings as part of project setup.

Work on a task branch and keep commits focused and reviewable. Ask before
merging into main.
