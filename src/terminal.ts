import { stripTerminalSequences } from "@earendil-works/pi-tui";

export function sanitizeForTerminal(text: string): string {
  const normalized = stripTerminalSequences(text)
    .replaceAll("\r\n", "\n")
    .replaceAll("\r", "\n")
    .replaceAll("\t", "   ");
  return Array.from(normalized, (character) => {
    const isControl =
      character < " " || (character >= "\u007F" && character <= "\u009F");
    return isControl && character !== "\n" ? "" : character;
  }).join("");
}

export function sanitizeSingleLine(text: string): string {
  return sanitizeForTerminal(text).replaceAll("\n", " ");
}

export type BellOutput = Readonly<{
  isTTY?: boolean | undefined;
  write: (text: string) => unknown;
}>;

// Only an interactive terminal gets the bell, so RPC, JSON, print, and
// redirected output stay byte-exact.
export function ringBell(
  mode: string,
  output: BellOutput = process.stdout,
): void {
  if (mode !== "tui" || output.isTTY !== true) {
    return;
  }
  try {
    output.write("\u0007");
  } catch {
    // A missed bell must not interrupt the work it announces.
  }
}
