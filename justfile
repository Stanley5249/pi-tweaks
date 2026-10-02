[windows]
set shell := ["pwsh", "-NoLogo", "-NoProfile", "-Command"]

set default-list

# Install the locked development toolchain.
install:
    bun install --frozen-lockfile

# Format project files and recipes.
# Direct invocation keeps bunx arguments out of formatter child workers.
fmt:
    just --fmt
    bun node_modules/oxfmt/bin/oxfmt

# Verify formatting without rewriting files.
fmt-check:
    just --fmt --check
    bun node_modules/oxfmt/bin/oxfmt --check

# Run strict lint and type checking through Oxc.
lint:
    bun node_modules/oxlint/bin/oxlint .

# Run the source-preserving static gate.
check: lint

# Verify the toolchain with positive and negative fixtures.
test:
    bun test

# Run all currently applicable verification gates.
ci: fmt-check check test
