export type Shell = "bash" | "powershell";

// Operators, substitution, and quotes. A quoted word can hide an option from
// the checks below, so any quote sends the command to the classifier.
const unsafeCharacters = /[|;&<>$`(){}'"\n\r‘-‟]/u;

// Bash also unescapes backslashes. PowerShell paths use them, so there only a
// leading `\\` is unsafe, because a UNC path authenticates to a remote host.
const unsafeBash = /\\|(?:^|\s)\/\//u;
const unsafePowerShell = /(?:^|\s)(?:\\\\|\/\/)/u;

// Programs with no option that writes, runs, or reaches the network. Adding
// one means checking all of its options, so the list stays short.
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
  const [first = "", ...rest] = command.trim().split(/\s+/u);
  const program = shell === "powershell" ? first.toLowerCase() : first;
  const allowed = shell === "powershell" ? readOnlyPowerShell : readOnlyBash;
  // `git status` takes no option that writes or runs a program.
  if (program === "git") {
    return rest.join(" ") === "status";
  }
  return allowed.has(program);
}
