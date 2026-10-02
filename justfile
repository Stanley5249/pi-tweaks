[windows]
set shell := ["pwsh", "-NoLogo", "-NoProfile", "-Command"]

set default-list

# Install project dependencies.
install:
    bun install

# Format project files and recipes.
fmt:
    just --fmt
    bunx oxfmt

# Verify formatting without rewriting files.
fmt-check:
    just --fmt --check
    bunx oxfmt --check

# Run strict lint and type checking through Oxc.
lint:
    bunx oxlint src tests

# Run the source-preserving static gate.
check: lint

# Verify the toolchain with positive and negative fixtures.
test:
    bun test

# Run all currently applicable verification gates.
ci: fmt-check check test
