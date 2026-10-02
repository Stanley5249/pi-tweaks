# pi-tweaks

Personal Pi extensions for context, scrolling, and status display.

## Development

Install Bun and just, then run:

```sh
just install
just ci
```

Use `just fmt` to format files and `just check` for static checks. `just lint`
runs both type-aware lint and compiler diagnostics through Oxc; there is no
separate ESLint or TypeScript compiler command.

Type checking uses Oxlint's experimental compiler-diagnostics integration. The
toolchain is locked, and tests verify both passing code and rejected errors.

## Zed

Install the [Oxc extension](https://github.com/oxc-project/oxc-zed). The tracked
project settings retain `vtsls` for completion and navigation, enable `oxlint`,
and select `oxfmt` for formatting on save. Prettier is disabled for this
project; global editor settings are unchanged.

To disable Zed's TypeScript LSP later, remove `vtsls` from the TypeScript and
JavaScript `language_servers` lists. Keep `oxlint` and `oxfmt` without the `...`
fallback. This removes semantic completion and navigation, not CLI type
checking. See
[Zed's TypeScript documentation](https://zed.dev/docs/languages/typescript).

## Context

The package exposes one extension entry, `src/context/index.ts`. Use `/context`
or `/context view` to inspect the current system prompt in a scrollable viewer.
`/context chat` records a durable snapshot card without adding it to model
context; Ctrl+O expands its prompt.

`/context copy` copies the original prompt, and `/context save [file]` writes it
relative to the working directory. The default filename is `system-prompt.md`.
Rendering strips terminal control sequences; copying and saving preserve the
original text. Token counts derived from character counts are estimates, not
tokenizer results.

In non-TUI modes, viewing records a snapshot rather than opening a terminal
component. The viewer supports line/page navigation, g/G for start/end, f for
height, c to copy, d/Enter to record a card, and q/Escape to close.

This entry is not enabled in your existing Pi configuration yet. Disable the old
context extension before installing this local package, otherwise the command
and renderer names collide.

## Status

Context is migrated. Status line remains to be migrated. Scroll speed uses Pi's
built-in `fullscreenWheelScrollLines` setting rather than another extension.
Existing user extensions and settings are unchanged.
