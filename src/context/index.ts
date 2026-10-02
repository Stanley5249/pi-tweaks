import { highlightCode } from "@earendil-works/pi-coding-agent";
import type { Theme } from "@earendil-works/pi-coding-agent";
import { Box, Text, truncateToWidth } from "@earendil-works/pi-tui";
import type { Component } from "@earendil-works/pi-tui";
import {
  formatModel,
  formatPromptSizeEstimate,
  sanitizeForTerminal,
} from "./data";
import type { ContextDumpData } from "./data";

const cardPadding = 1;
type CardTheme = Readonly<Pick<Theme, "bg" | "bold" | "fg">>;

export function renderContextCard(
  data: Readonly<ContextDumpData> | undefined,
  expanded: boolean,
  theme: CardTheme,
): Component {
  if (data === undefined) {
    return new Text("No prompt data", 0, 0);
  }
  const box = new Box(cardPadding, cardPadding, (text) =>
    theme.bg("customMessageBg", text),
  );
  const title = theme.fg(
    "accent",
    theme.bold("[context] System Prompt Snapshot"),
  );
  box.addChild(new Text(title, 0, 0));
  const tokens = data.usage
    ? `${data.usage.tokens?.toLocaleString() ?? "unknown"} / ${data.usage.contextWindow.toLocaleString()} tokens`
    : "unknown tokens";
  const summary = `Model: ${formatModel(data)} | ${tokens} | Prompt: ${data.promptCharCount.toLocaleString()} chars | ${formatPromptSizeEstimate(data)}`;
  box.addChild(new Text(theme.fg("muted", summary), 0, 0));
  if (expanded) {
    const safePrompt =
      sanitizeForTerminal(data.systemPrompt) || "(Empty system prompt)";
    box.addChild(new Text(theme.fg("accent", "\n=== SYSTEM PROMPT ==="), 0, 0));
    box.addChild(
      new Text(highlightCode(safePrompt, "markdown").join("\n"), 0, 0),
    );
  } else {
    box.addChild(
      new Text(
        theme.fg("dim", "Press Ctrl+O to expand full system prompt"),
        0,
        0,
      ),
    );
  }
  return {
    invalidate: () => box.invalidate(),
    render: (width) =>
      box.render(width).map((line) => truncateToWidth(line, width, "")),
  };
}
