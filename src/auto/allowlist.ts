export type Shell = "bash" | "powershell";

// Any of these can chain, redirect, substitute, or escape into another
// command, so a command containing one goes to the classifier instead.
const unsafeCharacters = /[|;&<>$`(){}\n\r]/u;

const readOnlyGit = new Set([
  "blame",
  "diff",
  "log",
  "ls-files",
  "rev-parse",
  "show",
  "status",
]);

const readOnlyBash = new Set([
  "cat",
  "df",
  "du",
  "file",
  "git",
  "grep",
  "head",
  "ls",
  "pwd",
  "rg",
  "stat",
  "tail",
  "tree",
  "wc",
  "which",
]);

// PowerShell resolves names case-insensitively, so entries are lowercase.
const readOnlyPowerShell = new Set([
  "cat",
  "gc",
  "gci",
  "get-childitem",
  "get-command",
  "get-content",
  "get-item",
  "get-location",
  "git",
  "gl",
  "ls",
  "pwd",
  "resolve-path",
  "rg",
  "select-string",
  "test-path",
]);

// Options that make an otherwise read-only program run or write something.
const unsafeOptions = ["--pre", "--output", "--ext-diff"];

function hasUnsafeOption(words: readonly string[]): boolean {
  return words.some((word) =>
    unsafeOptions.some((option) => word.startsWith(option)),
  );
}

export function isReadOnly(shell: Shell, command: string): boolean {
  if (unsafeCharacters.test(command)) {
    return false;
  }
  const words = command.trim().split(/\s+/u);
  const program = shell === "powershell" ? words[0]?.toLowerCase() : words[0];
  const allowed = shell === "powershell" ? readOnlyPowerShell : readOnlyBash;
  if (program === undefined || !allowed.has(program)) {
    return false;
  }
  if (hasUnsafeOption(words)) {
    return false;
  }
  return program !== "git" || readOnlyGit.has(words[1] ?? "");
}
