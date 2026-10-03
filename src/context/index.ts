import { copyToClipboard } from "@earendil-works/pi-coding-agent";
import type {
  ExtensionAPI,
  ExtensionCommandContext,
  ExtensionUIContext,
  Theme,
} from "@earendil-works/pi-coding-agent";
import type { Component } from "@earendil-works/pi-tui";
import { createPromptViewer } from "./viewer";

const usage = "Usage: /context [view|copy]";
type Clipboard = (text: string) => Promise<void>;
type Notifier = Readonly<Pick<ExtensionUIContext, "notify">>;
export type ContextAPI = Readonly<Pick<ExtensionAPI, "registerCommand">>;
export type ContextCommandSource = Readonly<
  Pick<ExtensionCommandContext, "getSystemPrompt" | "mode"> & {
    ui: Readonly<Pick<ExtensionUIContext, "custom" | "notify">>;
  }
>;

async function copyPrompt(
  prompt: string,
  ui: Notifier,
  copy: Clipboard,
): Promise<void> {
  try {
    await copy(prompt);
    ui.notify("Copied system prompt to clipboard", "info");
  } catch {
    ui.notify("Failed to copy system prompt", "error");
  }
}

async function openViewer(
  prompt: string,
  ctx: ContextCommandSource,
  copy: Clipboard,
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
    return createPromptViewer(prompt, {
      close: () => done(),
      copy: async () => copyPrompt(prompt, ctx.ui, copy),
      getRows: () => tui.terminal.rows,
      requestRender: () => tui.requestRender(),
      theme,
    });
  }
  await ctx.ui.custom<void>(factory);
}

export async function runContextCommand(
  args: string,
  ctx: ContextCommandSource,
  copy: Clipboard = copyToClipboard,
): Promise<void> {
  const action = args.trim().toLowerCase() || "view";
  if (action === "copy") {
    await copyPrompt(ctx.getSystemPrompt(), ctx.ui, copy);
  } else if (action !== "view") {
    ctx.ui.notify(usage, "error");
  } else if (ctx.mode === "tui") {
    await openViewer(ctx.getSystemPrompt(), ctx, copy);
  } else {
    ctx.ui.notify("The viewer needs the TUI; use /context copy", "error");
  }
}

export default function contextExtension(pi: ContextAPI): void {
  pi.registerCommand("context", {
    description: "Preview the system prompt (/context [view|copy])",
    handler: async (args, ctx: ContextCommandSource) =>
      runContextCommand(args, ctx),
  });
}
