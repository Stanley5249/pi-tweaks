import { expect, test } from "bun:test";
import { isReadOnly } from "../../src/auto/allowlist";

test("plain read-only commands skip the classifier", () => {
  expect(isReadOnly("bash", "ls -la src")).toBe(true);
  expect(isReadOnly("bash", "head -n 20 src/auto/index.ts")).toBe(true);
  expect(isReadOnly("powershell", "Get-ChildItem -Recurse src")).toBe(true);
  expect(
    isReadOnly("powershell", String.raw`get-content src\auto\index.ts`),
  ).toBe(true);
});

test("chaining, redirection, and substitution go to the classifier", () => {
  expect(isReadOnly("bash", "ls && rm -rf build")).toBe(false);
  expect(isReadOnly("bash", "cat a > b")).toBe(false);
  expect(isReadOnly("bash", "cat $(which rm)")).toBe(false);
  expect(isReadOnly("bash", "ls | xargs rm")).toBe(false);
  expect(isReadOnly("bash", "ls\nrm a")).toBe(false);
  expect(isReadOnly("powershell", "Get-Item a; Remove-Item a")).toBe(false);
});

test("quotes, escapes, and UNC paths go to the classifier", () => {
  expect(isReadOnly("bash", 'cat "--help"')).toBe(false);
  expect(isReadOnly("bash", String.raw`cat \-x`)).toBe(false);
  expect(isReadOnly("powershell", "cat \u201C-Wait\u201D")).toBe(false);
  expect(isReadOnly("bash", "cat //evil/share/x")).toBe(false);
  expect(isReadOnly("powershell", String.raw`Get-Content \\evil\share`)).toBe(
    false,
  );
});

test("other programs and git subcommands go to the classifier", () => {
  expect(isReadOnly("bash", "git status")).toBe(false);
  expect(isReadOnly("powershell", String.raw`gc -Path:\\evil\s`)).toBe(false);
  expect(isReadOnly("powershell", "cat FileSystem:://evil/s")).toBe(false);
  expect(isReadOnly("powershell", String.raw`cat /\evil\s`)).toBe(false);
  expect(isReadOnly("powershell", String.raw`gc \/evil/s`)).toBe(false);
  expect(isReadOnly("bash", "git push")).toBe(false);
  expect(isReadOnly("bash", "rg --pre=sh x")).toBe(false);
  expect(isReadOnly("bash", "tree -o out")).toBe(false);
  expect(isReadOnly("bash", "rm -rf build")).toBe(false);
  expect(isReadOnly("bash", "")).toBe(false);
});

test("shell names match their own case rules", () => {
  expect(isReadOnly("powershell", "GET-CONTENT README.md")).toBe(true);
  expect(isReadOnly("bash", "LS")).toBe(false);
  expect(isReadOnly("bash", "Get-Content README.md")).toBe(false);
});
