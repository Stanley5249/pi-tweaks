import { expect, test } from "bun:test";
import { isReadOnly } from "../../src/auto/allowlist";

test("plain read-only commands skip the classifier", () => {
  expect(isReadOnly("bash", "ls -la src")).toBe(true);
  expect(isReadOnly("bash", "git status --short")).toBe(true);
  expect(isReadOnly("bash", 'rg "needle" src')).toBe(true);
  expect(isReadOnly("powershell", "Get-ChildItem -Recurse src")).toBe(true);
  expect(isReadOnly("powershell", "git log -5")).toBe(true);
});

test("chaining, redirection, and substitution go to the classifier", () => {
  expect(isReadOnly("bash", "ls && rm -rf build")).toBe(false);
  expect(isReadOnly("bash", "cat a > b")).toBe(false);
  expect(isReadOnly("bash", "cat $(which rm)")).toBe(false);
  expect(isReadOnly("bash", "ls | xargs rm")).toBe(false);
  expect(isReadOnly("powershell", "Get-Item a; Remove-Item a")).toBe(false);
  expect(isReadOnly("bash", "ls\nrm a")).toBe(false);
});

test("writing subcommands and options go to the classifier", () => {
  expect(isReadOnly("bash", "git push")).toBe(false);
  expect(isReadOnly("bash", "git -c core.pager=sh log")).toBe(false);
  expect(isReadOnly("bash", "git diff --output=patch")).toBe(false);
  expect(isReadOnly("bash", "rg --pre ./run x")).toBe(false);
  expect(isReadOnly("bash", "rm -rf build")).toBe(false);
  expect(isReadOnly("bash", "")).toBe(false);
});

test("shell names match their own case rules", () => {
  expect(isReadOnly("powershell", "get-content README.md")).toBe(true);
  expect(isReadOnly("bash", "LS")).toBe(false);
  expect(isReadOnly("bash", "Get-Content README.md")).toBe(false);
});
