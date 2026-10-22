/**
 * Guard: a shell command guard modeled on Claude Code's auto mode.
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
 * Without a UI, asking the user blocks. config.ts describes the config
 * files, including when the guard starts on.
 */
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import type {
  ExtensionAPI,
  ExtensionUIContext,
  ToolCallEventResult,
} from "@earendil-works/pi-coding-agent";
import { isReadOnly } from "./allowlist";
import type { Shell } from "./allowlist";
import {
  classifyCommand,
  collectTranscript,
  findClassifier,
  formatContextFiles,
} from "./classify";
import type {
  Classifier,
  ClassifierRegistry,
  ContextFile,
  TranscriptEntry,
  Verdict,
} from "./classify";
import { createBlockCounter, decide } from "./blocks";
import { processChoice } from "./choice";
import type { Choice } from "./choice";
import type { Action } from "./blocks";
import { defaultConfig, loadConfig } from "./config";
import type { GuardConfig } from "./config";

export type GuardContext = Readonly<{
  cwd: string;
  hasUI: boolean;
  modelRegistry: ClassifierRegistry;
  sessionManager: Readonly<{ getBranch: () => readonly TranscriptEntry[] }>;
  signal?: AbortSignal | undefined;
  ui: Readonly<Pick<ExtensionUIContext, "notify" | "select" | "setStatus">>;
}>;

type PromptOptions = Readonly<{
  contextFiles?: readonly ContextFile[] | undefined;
}>;

export type GuardAPI = Readonly<Pick<ExtensionAPI, "on" | "registerCommand">>;

export type ShellCall = Readonly<{ shell: Shell; command: string }>;

export type ToolCall = Readonly<{
  toolName: string;
  input: Readonly<Record<string, unknown>>;
}>;

export type GuardResult = ToolCallEventResult | undefined;

export type GuardController = Readonly<{
  guard: (call: ShellCall, ctx: GuardContext) => Promise<GuardResult>;
  isEnabled: () => boolean;
  status: () => string;
  load: (ctx: GuardContext, agentDir: string) => Promise<void>;
  setEnabled: (ctx: GuardContext, enabled: boolean) => void;
  setInstructions: (text: string) => void;
}>;

const allowOnce = "Allow once";

export async function askUser(
  ctx: GuardContext,
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
  config: GuardConfig;
  classifier: Classifier | undefined;
  projectInstructions: string;
}>;

const emptySession: Session = {
  classifier: undefined,
  config: defaultConfig,
  projectInstructions: "",
};

function warn(ctx: GuardContext, messages: readonly string[]): void {
  for (const message of messages) {
    ctx.ui.notify(`Guard: ${message}`, "warning");
  }
}

function noClassifier(config: GuardConfig): string {
  return `no classifier available from ${config.models.join(", ")}`;
}

async function classify(
  call: ShellCall,
  ctx: GuardContext,
  session: Session,
): Promise<Verdict> {
  const { config } = session;
  const model = session.classifier;
  if (model === undefined) {
    return { kind: "error", reason: noClassifier(config) };
  }
  const verdict = await classifyCommand(ctx.modelRegistry, model, {
    ...call,
    config,
    cwd: ctx.cwd,
    projectInstructions: session.projectInstructions,
    signal: ctx.signal,
    transcript: collectTranscript(ctx.sessionManager.getBranch()),
  });
  // A classifier can finish just after the user aborts.
  return ctx.signal?.aborted === true ? { kind: "aborted" } : verdict;
}

async function respond(
  action: Action,
  call: ShellCall,
  ctx: GuardContext,
): Promise<GuardResult> {
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
      ? `Guard is off: ${noClassifier(session.config)}`
      : "Guard is off";
  }
  return model === undefined
    ? `Guard is on, but ${noClassifier(session.config)}`
    : `Guard is on, using ${model.provider}/${model.id}`;
}

export function createGuardController(
  choice: Choice = processChoice,
): GuardController {
  let session = emptySession;
  let enabled = false;
  const blocks = createBlockCounter();

  async function load(ctx: GuardContext, agentDir: string): Promise<void> {
    const { config, problems } = await loadConfig(agentDir, ctx.cwd);
    const classifier = await findClassifier(ctx.modelRegistry, config.models);
    session = { ...session, classifier, config };
    // On by default, but only an explicit choice runs without a classifier.
    const explicit = choice.get() ?? config.enabled;
    enabled = explicit ?? classifier !== undefined;
    blocks.reset();
    ctx.ui.setStatus("guard", enabled ? "guard" : undefined);
    const missing = classifier === undefined && explicit !== false;
    warn(ctx, missing ? [...problems, noClassifier(config)] : problems);
  }

  function setEnabled(ctx: GuardContext, value: boolean): void {
    enabled = value;
    choice.set(value);
    ctx.ui.setStatus("guard", enabled ? "guard" : undefined);
    ctx.ui.notify(statusText(enabled, session), "info");
  }

  async function guard(
    call: ShellCall,
    ctx: GuardContext,
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
    setInstructions: (text) => {
      session = { ...session, projectInstructions: text };
    },
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

export function runGuardCommand(
  args: string,
  ctx: GuardContext,
  controller: GuardController,
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
      ctx.ui.notify("Usage: /guard [on|off]", "error");
      break;
    }
  }
}

export default function guardExtension(pi: GuardAPI): void {
  const controller = createGuardController();

  pi.on("session_start", async (_event: unknown, ctx: GuardContext) => {
    await controller.load(ctx, getAgentDir());
  });

  // pi loads AGENTS.md and similar files per prompt, so capture them here.
  pi.on(
    "before_agent_start",
    (event: Readonly<{ systemPromptOptions: PromptOptions }>) => {
      controller.setInstructions(
        formatContextFiles(event.systemPromptOptions.contextFiles ?? []),
      );
    },
  );

  pi.on("tool_call", async (event: ToolCall, ctx: GuardContext) => {
    const call = shellCallOf(event);
    return call === undefined ? undefined : controller.guard(call, ctx);
  });

  pi.registerCommand("guard", {
    description: "Show or set the shell command guard (/guard [on|off])",
    handler: async (args: string, ctx: GuardContext) => {
      runGuardCommand(args, ctx, controller);
    },
  });
}
