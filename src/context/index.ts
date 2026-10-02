import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  copyToClipboard,
  highlightCode,
} from "@earendil-works/pi-coding-agent";
import type {
  ExtensionAPI,
  ExtensionCommandContext,
  ExtensionUIContext,
  Theme,
} from "@earendil-works/pi-coding-agent";
import { Box, Text, truncateToWidth } from "@earendil-works/pi-tui";
import type { Component } from "@earendil-works/pi-tui";
import {
  collectPromptData,
  formatModel,
  formatPromptSizeEstimate,
  parseContextCommand,
} from "./data";
import { sanitizeForTerminal } from "../terminal";
import type { ContextDumpData, PromptSource } from "./data";
import { createPromptViewer } from "./viewer";

const cardPadding = 1;
const usage = "Usage: /context [view|chat|copy|save [--force] [file]]";
type Clipboard = (text: string) => Promise<void>;
type CommandEffects = Readonly<
  Pick<ExtensionAPI, "appendEntry"> & {
    copy?: Clipboard;
  }
>;
type CardTheme = Readonly<Pick<Theme, "bg" | "bold" | "fg">>;
export type ContextAPI = Readonly<
  Pick<
    ExtensionAPI,
    "appendEntry" | "registerCommand" | "registerEntryRenderer"
  >
>;
export type ContextCommandSource = Readonly<
  PromptSource &
    Pick<ExtensionCommandContext, "cwd" | "mode"> & {
      ui: Readonly<Pick<ExtensionUIContext, "custom" | "notify">>;
    }
>;

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

async function copyPrompt(
  prompt: string,
  ui: Readonly<Pick<ExtensionUIContext, "notify">>,
  copy: Clipboard,
): Promise<void> {
  try {
    await copy(prompt);
    ui.notify("Copied system prompt to clipboard", "info");
  } catch {
    ui.notify("Failed to copy", "error");
  }
}

async function savePrompt(
  prompt: string,
  command: Readonly<{ file: string; overwrite: boolean }>,
  ctx: ContextCommandSource,
): Promise<void> {
  const { file, overwrite } = command;
  try {
    // Exclusive creation avoids an overwrite race between checking and writing.
    await writeFile(resolve(ctx.cwd, file), prompt, {
      encoding: "utf8",
      flag: overwrite ? "w" : "wx",
    });
    ctx.ui.notify(`Saved system prompt to ${file}`, "info");
  } catch (error) {
    const exists =
      error instanceof Error && "code" in error && error.code === "EEXIST";
    let message = error instanceof Error ? error.message : "Unknown error";
    if (exists) {
      message =
        "File already exists; use /context save --force [file] to overwrite";
    }
    ctx.ui.notify(`Failed to save system prompt: ${message}`, "error");
  }
}

async function openViewer(
  data: Readonly<ContextDumpData>,
  ctx: ContextCommandSource,
  actions: Readonly<{ chat: () => void; copy: Clipboard }>,
): Promise<void> {
  // oxlint-disable-next-line max-params -- Pi requires four UI factory arguments.
  function factory(
    tui: Readonly<{
      requestRender: () => void;
      terminal: Readonly<{ rows: number }>;
    }>,
    theme: Readonly<Pick<Theme, "bold" | "fg">>,
    _keybindings: unknown,
    done: () => void,
  ): Component {
    return createPromptViewer(data, {
      chat: actions.chat,
      close: () => done(),
      copy: async () => copyPrompt(data.systemPrompt, ctx.ui, actions.copy),
      getRows: () => tui.terminal.rows,
      onError: () => ctx.ui.notify("Failed to copy", "error"),
      requestRender: () => tui.requestRender(),
      theme,
    });
  }
  await ctx.ui.custom<void>(factory);
}

export async function runContextCommand(
  args: string,
  ctx: ContextCommandSource,
  api: CommandEffects,
): Promise<void> {
  const copy = api.copy ?? copyToClipboard;
  const command = parseContextCommand(args);
  if (command === undefined) {
    ctx.ui.notify(usage, "error");
    return;
  }
  const data = collectPromptData(ctx);
  function chat(): void {
    api.appendEntry<ContextDumpData>("context-dump", data);
    ctx.ui.notify("Dumped system prompt card to chat", "info");
  }
  switch (command.mode) {
    case "copy": {
      await copyPrompt(data.systemPrompt, ctx.ui, copy);
      break;
    }
    case "save": {
      await savePrompt(data.systemPrompt, command, ctx);
      break;
    }
    case "chat": {
      chat();
      break;
    }
    case "view": {
      if (ctx.mode === "tui") {
        await openViewer(data, ctx, { chat, copy });
      } else {
        chat();
      }
      break;
    }
  }
}

export default function contextExtension(pi: ContextAPI): void {
  pi.registerEntryRenderer<ContextDumpData>(
    "context-dump",
    (
      entry: Readonly<{ data?: Readonly<ContextDumpData> | undefined }>,
      options: Readonly<{ expanded: boolean }>,
      theme: CardTheme,
    ) => renderContextCard(entry.data, options.expanded, theme),
  );
  pi.registerCommand("context", {
    description:
      "Inspect system prompt (/context [view|chat|copy|save [--force] [file]])",
    handler: async (args, ctx: ContextCommandSource) =>
      runContextCommand(args, ctx, pi),
  });
}
