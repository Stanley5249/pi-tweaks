/**
 * Auto mode: a command guard modeled on Claude Code's auto mode.
 *
 * Read-only commands in `allowlist.ts` run directly. Other `bash` and
 * `powershell` calls go to a classifier model with the user's messages and
 * recent tool calls. A block goes back to the model with the reason, and the
 * user decides after repeated blocks or when the classifier fails.
 */
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import type {
  ExtensionAPI,
  ExtensionUIContext,
  ToolCallEventResult,
} from "@earendil-works/pi-coding-agent";
import { isReadOnly } from "./allowlist";
import type { Shell } from "./allowlist";
import { classifyCommand, collectTranscript, findClassifier } from "./classify";
import type { ClassifierRegistry, TranscriptEntry, Verdict } from "./classify";
import { defaultConfig, loadConfig } from "./config";
import type { AutoConfig } from "./config";

export type AutoContext = Readonly<{
  cwd: string;
  hasUI: boolean;
  modelRegistry: ClassifierRegistry;
  sessionManager: Readonly<{ getBranch: () => readonly TranscriptEntry[] }>;
  signal?: AbortSignal | undefined;
  ui: Readonly<Pick<ExtensionUIContext, "notify" | "select" | "setStatus">>;
}>;

export type AutoAPI = Readonly<Pick<ExtensionAPI, "on" | "registerCommand">>;

export type ShellCall = Readonly<{ shell: Shell; command: string }>;

export type ToolCall = Readonly<{
  toolName: string;
  input: Readonly<Record<string, unknown>>;
}>;

export type GuardResult = ToolCallEventResult | undefined;

export type AutoController = Readonly<{
  guard: (call: ShellCall, ctx: AutoContext) => Promise<GuardResult>;
  isEnabled: () => boolean;
  load: (ctx: AutoContext, agentDir: string) => Promise<void>;
  setEnabled: (ctx: AutoContext, enabled: boolean) => void;
}>;

// Claude Code's auto mode hands control back to the user after this many
// blocks in a row or in one session.
export const maxConsecutiveBlocks = 3;
export const maxTotalBlocks = 20;

const allowOnce = "Allow once";

export async function askUser(
  ctx: AutoContext,
  call: ShellCall,
  reason: string,
): Promise<GuardResult> {
  if (!ctx.hasUI) {
    return { block: true, reason };
  }
  const choice = await ctx.ui.select(`${reason}\n\n  ${call.command}`, [
    allowOnce,
    "Block",
  ]);
  if (choice === allowOnce) {
    return undefined;
  }
  return {
    block: true,
    reason: "The user blocked this command. Ask the user how to proceed.",
  };
}

async function classify(
  call: ShellCall,
  ctx: AutoContext,
  config: AutoConfig,
): Promise<Verdict> {
  const model = await findClassifier(ctx.modelRegistry, config.models);
  if (model === undefined) {
    return {
      kind: "error",
      reason: `no classifier available from ${config.models.join(", ")}`,
    };
  }
  return classifyCommand(ctx.modelRegistry, model, {
    ...call,
    config,
    cwd: ctx.cwd,
    signal: ctx.signal,
    transcript: collectTranscript(ctx.sessionManager.getBranch()),
  });
}

export type BlockCounter = Readonly<{
  /** Records a block; true means the user should decide this time. */
  block: () => boolean;
  allow: () => void;
  reset: () => void;
}>;

export function createBlockCounter(): BlockCounter {
  let consecutive = 0;
  let total = 0;
  return {
    allow: () => {
      consecutive = 0;
    },
    block: () => {
      consecutive += 1;
      total += 1;
      if (consecutive < maxConsecutiveBlocks && total < maxTotalBlocks) {
        return false;
      }
      consecutive = 0;
      return true;
    },
    reset: () => {
      consecutive = 0;
      total = 0;
    },
  };
}

export type Action =
  | Readonly<{ kind: "allow" }>
  | Readonly<{ kind: "ask" | "block"; reason: string }>;

export function decide(verdict: Verdict, blocks: BlockCounter): Action {
  if (verdict.kind === "allow") {
    blocks.allow();
    return verdict;
  }
  if (verdict.kind === "error") {
    return {
      kind: "ask",
      reason: `Auto mode cannot decide: ${verdict.reason}`,
    };
  }
  return { kind: blocks.block() ? "ask" : "block", reason: verdict.reason };
}

export function createAutoController(): AutoController {
  let config = defaultConfig;
  let enabled = false;
  const blocks = createBlockCounter();

  function sync(ctx: AutoContext): void {
    ctx.ui.setStatus("auto", enabled ? "auto" : undefined);
  }

  async function load(ctx: AutoContext, agentDir: string): Promise<void> {
    const loaded = await loadConfig(agentDir, ctx.cwd);
    ({ config } = loaded);
    ({ enabled } = config);
    blocks.reset();
    for (const problem of loaded.problems) {
      ctx.ui.notify(`Auto mode: ${problem}`, "warning");
    }
    sync(ctx);
  }

  function setEnabled(ctx: AutoContext, value: boolean): void {
    enabled = value;
    sync(ctx);
    ctx.ui.notify(`Auto mode ${enabled ? "enabled" : "disabled"}`, "info");
  }

  async function guard(
    call: ShellCall,
    ctx: AutoContext,
  ): Promise<GuardResult> {
    if (!enabled || isReadOnly(call.shell, call.command)) {
      return undefined;
    }
    const action = decide(await classify(call, ctx, config), blocks);
    if (action.kind === "allow") {
      return undefined;
    }
    return action.kind === "ask"
      ? askUser(ctx, call, action.reason)
      : { block: true, reason: action.reason };
  }

  return { guard, isEnabled: () => enabled, load, setEnabled };
}

export function shellCallOf(event: ToolCall): ShellCall | undefined {
  const { command } = event.input;
  if (typeof command !== "string") {
    return undefined;
  }
  if (event.toolName === "bash" || event.toolName === "powershell") {
    return { command, shell: event.toolName };
  }
  return undefined;
}

export function runAutoCommand(
  args: string,
  ctx: AutoContext,
  controller: AutoController,
): void {
  switch (args.trim().toLowerCase()) {
    case "": {
      controller.setEnabled(ctx, !controller.isEnabled());
      break;
    }
    case "on": {
      controller.setEnabled(ctx, true);
      break;
    }
    case "off": {
      controller.setEnabled(ctx, false);
      break;
    }
    default: {
      ctx.ui.notify("Usage: /auto [on|off]", "error");
      break;
    }
  }
}

export default function autoExtension(pi: AutoAPI): void {
  const controller = createAutoController();

  pi.on("session_start", async (_event: unknown, ctx: AutoContext) => {
    await controller.load(ctx, getAgentDir());
  });

  pi.on("tool_call", async (event: ToolCall, ctx: AutoContext) => {
    const call = shellCallOf(event);
    return call === undefined ? undefined : controller.guard(call, ctx);
  });

  pi.registerCommand("auto", {
    description: "Toggle the auto mode command guard (/auto [on|off])",
    handler: async (args: string, ctx: AutoContext) => {
      runAutoCommand(args, ctx, controller);
    },
  });
}
