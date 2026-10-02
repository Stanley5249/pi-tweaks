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

## Status

This repository contains the development toolchain only. The context,
scroll-speed, and status-line extensions have not been migrated. It is not yet
an installable Pi package.
