export type Shell = "bash" | "powershell";

// Operators, substitution, and quotes. A quoted word can hide an option from
// the checks below, so any quote sends the command to the classifier.
const unsafeCharacters = /[|;&<>$`(){}'"\n\r‘-‟]/u;

// A UNC path authenticates to a remote host, and Windows accepts either
// separator in it, as in `\\host`, `//host`, or `/\host`. Bash also unescapes
// single backslashes, but PowerShell paths use them, so PowerShell only
// rejects two separators in a row.
const unsafeBash = /\\|\/\//u;
const unsafePowerShell = /[\\/]{2}/u;

// Programs with no option that writes, runs, or reaches the network. Adding
// one means checking all of its options, so the list stays short. `git` is
// left out, because a repository's config can run programs on any command.
const readOnlyBash = new Set(["cat", "head", "ls", "pwd", "wc"]);

// PowerShell resolves names case-insensitively, so entries are lowercase.
const readOnlyPowerShell = new Set([
  "cat",
  "dir",
  "gc",
  "gci",
  "get-childitem",
  "get-content",
  "get-location",
  "gl",
  "ls",
  "pwd",
  "resolve-path",
  "test-path",
]);

export function isReadOnly(shell: Shell, command: string): boolean {
  const unsafe = shell === "bash" ? unsafeBash : unsafePowerShell;
  if (unsafeCharacters.test(command) || unsafe.test(command)) {
    return false;
  }
  const [first = ""] = command.trim().split(/\s+/u);
  const program = shell === "powershell" ? first.toLowerCase() : first;
  const allowed = shell === "powershell" ? readOnlyPowerShell : readOnlyBash;
  return allowed.has(program);
}
