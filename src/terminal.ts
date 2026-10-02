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
