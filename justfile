[windows]
set shell := ["pwsh", "-NoLogo", "-NoProfile", "-Command"]

set default-list

# Install project dependencies.
install *args:
    bun install {{ args }}

# Format project files and recipes.
[parallel]
fmt: _fmt-oxfmt _fmt-just

# Verify formatting without rewriting files.
[parallel]
fmt-check: (_fmt-oxfmt "--check") (_fmt-just "--check")

_fmt-oxfmt *args:
    bunx oxfmt {{ args }}

_fmt-just *args:
    just --fmt {{ args }}

# Run strict lint and type checking through Oxc.
lint *args:
    bunx oxlint src tests scripts {{ args }}

# Run the source-preserving static gate.
check: lint

# Verify the toolchain with positive and negative fixtures.
test *args:
    bun test {{ args }}

# Run all currently applicable verification gates.
ci: fmt-check check test

# Bundle installed npm Pi extensions to speed up startup.
bundle *args:
    bun run scripts/bundle.ts {{ args }}

# Patch the installed Pi until upstream fixes land.
patch *args:
    bun run scripts/patch.ts {{ args }}

# Upgrade Pi and its packages, then reapply patches and bundles.
upgrade *bundles:
    bun install -g @earendil-works/pi-coding-agent@latest
    pi update --extensions
    just patch
    just bundle {{ bundles }}
