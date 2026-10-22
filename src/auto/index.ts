/**
 * Auto mode: a command guard modeled on Claude Code's auto mode.
 *
 * ```text
 * tool_call (bash or powershell)
 *   |-- guard off, or a read-only command (allowlist.ts) -> run
 *   `-- classifier (classify.ts)
 *         |-- allow -> run, and reset the block streak
 *         |-- block -> the reason goes back to the model
 *         |     after too many blocks (blocks.ts) -> ask the user
 *         |-- error -> ask the user
 *         `-- aborted -> block
 * ```
 *
 * Without a UI, asking the user blocks. The guard starts on when a classifier
 * is available, unless the config or `/auto` says otherwise. config.ts
 * describes the config files.
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
import type {
  Classifier,
  ClassifierRegistry,
  TranscriptEntry,
  Verdict,
} from "./classify";
import { createBlockCounter, decide } from "./blocks";
import type { Action } from "./blocks";
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
  status: () => string;
  load: (ctx: AutoContext, agentDir: string) => Promise<void>;
  setEnabled: (ctx: AutoContext, enabled: boolean) => void;
}>;

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

type Session = Readonly<{
  config: AutoConfig;
  classifier: Classifier | undefined;
}>;

function noClassifier(config: AutoConfig): string {
  return `no classifier available from ${config.models.join(", ")}`;
}

async function classify(
  call: ShellCall,
  ctx: AutoContext,
  session: Session,
): Promise<Verdict> {
  const { config } = session;
  const model = session.classifier;
  if (model === undefined) {
    return { kind: "error", reason: noClassifier(config) };
  }
  return classifyCommand(ctx.modelRegistry, model, {
    ...call,
    config,
    cwd: ctx.cwd,
    signal: ctx.signal,
    transcript: collectTranscript(ctx.sessionManager.getBranch()),
  });
}

async function respond(
  action: Action,
  call: ShellCall,
  ctx: AutoContext,
): Promise<GuardResult> {
  if (ctx.signal?.aborted === true) {
    return { block: true, reason: "Aborted by the user." };
  }
  if (action.kind === "ask") {
    return askUser(ctx, call, action.reason);
  }
  return action.kind === "block"
    ? { block: true, reason: action.reason }
    : undefined;
}

function statusText(enabled: boolean, session: Session): string {
  const model = session.classifier;
  if (!enabled) {
    return model === undefined
      ? `Auto mode is off: ${noClassifier(session.config)}`
      : "Auto mode is off";
  }
  return model === undefined
    ? `Auto mode is on, but ${noClassifier(session.config)}`
    : `Auto mode is on, using ${model.provider}/${model.id}`;
}

export function createAutoController(): AutoController {
  let session: Session = { classifier: undefined, config: defaultConfig };
  let enabled = false;
  // Set by `/auto`, so a new, resumed, or forked session keeps the choice.
  const chosen: { enabled?: boolean } = {};
  const blocks = createBlockCounter();

  async function load(ctx: AutoContext, agentDir: string): Promise<void> {
    const { config, problems } = await loadConfig(agentDir, ctx.cwd);
    const classifier = await findClassifier(ctx.modelRegistry, config.models);
    session = { classifier, config };
    // On by default, but only an explicit choice runs without a classifier.
    enabled = chosen.enabled ?? config.enabled ?? classifier !== undefined;
    blocks.reset();
    for (const problem of problems) {
      ctx.ui.notify(`Auto mode: ${problem}`, "warning");
    }
    ctx.ui.setStatus("auto", enabled ? "auto" : undefined);
    if (classifier === undefined) {
      ctx.ui.notify(statusText(enabled, session), "warning");
    }
  }

  function setEnabled(ctx: AutoContext, value: boolean): void {
    enabled = value;
    chosen.enabled = value;
    ctx.ui.setStatus("auto", enabled ? "auto" : undefined);
    ctx.ui.notify(statusText(enabled, session), "info");
  }

  async function guard(
    call: ShellCall,
    ctx: AutoContext,
  ): Promise<GuardResult> {
    if (!enabled || isReadOnly(call.shell, call.command)) {
      return undefined;
    }
    const action = decide(await classify(call, ctx, session), blocks);
    return respond(action, call, ctx);
  }

  return {
    guard,
    isEnabled: () => enabled,
    load,
    setEnabled,
    status: () => statusText(enabled, session),
  };
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
      ctx.ui.notify(controller.status(), "info");
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
    description: "Show or set the auto mode command guard (/auto [on|off])",
    handler: async (args: string, ctx: AutoContext) => {
      runAutoCommand(args, ctx, controller);
    },
  });
}
