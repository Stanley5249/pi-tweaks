/* oxlint-disable max-lines -- Keep the controller and its thin event wiring together; rendering lives in render.ts. */
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
  MessageEndEvent,
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
import { createGuardRenderer, recordOf } from "./render";
import type { GuardMetadata } from "./render";

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

export type GuardAPI = Readonly<
  Pick<ExtensionAPI, "on" | "registerCommand" | "registerToolRenderer">
>;

export type ShellCall = Readonly<{ shell: Shell; command: string }>;

export type ToolCall = Readonly<{
  toolName: string;
  input: Readonly<Record<string, unknown>>;
}>;

export type GuardResult = ToolCallEventResult | undefined;

export type GuardController = Readonly<{
  guard: (
    call: ShellCall,
    ctx: GuardContext,
    record?: (metadata: GuardMetadata) => void,
  ) => Promise<GuardResult>;
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
  try {
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
  } catch (error) {
    return ctx.signal?.aborted === true
      ? { kind: "aborted" }
      : { kind: "error", reason: String(error) };
  }
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

// oxlint-disable-next-line max-lines-per-function -- Controller closures share session state and keep its ownership local.
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
    record?: (metadata: GuardMetadata) => void,
  ): Promise<GuardResult> {
    if (!enabled || isReadOnly(call.shell, call.command)) {
      record?.({ decision: "allow", source: enabled ? "allowlist" : "off" });
      return undefined;
    }
    const model = session.classifier;
    const started = performance.now();
    const verdict = await classify(call, ctx, session);
    const durationMs = Math.round(performance.now() - started);
    const action = decide(verdict, blocks);
    const result = await respond(action, call, ctx);
    record?.({
      decision: result?.block === true ? "block" : "allow",
      source: action.kind === "ask" && ctx.hasUI ? "user" : "classifier",
      verdict: verdict.kind,
      ...(model === undefined
        ? {}
        : { durationMs, model: `${model.provider}/${model.id}` }),
      ...("probability" in verdict ? { probability: verdict.probability } : {}),
      ...("reason" in verdict ? { reason: verdict.reason } : {}),
    });
    return result;
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

// oxlint-disable-next-line max-lines-per-function -- Keep the extension's related event registrations in one place.
export default function guardExtension(pi: GuardAPI): void {
  const controller = createGuardController();
  const pending = new Map<string, GuardMetadata>();
  pi.registerToolRenderer(createGuardRenderer((id) => pending.get(id)));

  pi.on("session_start", async (_event: unknown, ctx: GuardContext) => {
    pending.clear();
    await controller.load(ctx, getAgentDir());
  });
  pi.on("session_shutdown", () => {
    pending.clear();
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

  pi.on(
    "tool_call",
    async (
      event: ToolCall & Readonly<{ toolCallId: string }>,
      ctx: GuardContext,
    ) => {
      const call = shellCallOf(event);
      return call === undefined
        ? undefined
        : controller.guard(call, ctx, (metadata) => {
            pending.set(event.toolCallId, metadata);
          });
    },
  );

  pi.on(
    "tool_result",
    (event: Readonly<{ toolCallId: string; details: unknown }>) => {
      const metadata = pending.get(event.toolCallId);
      pending.delete(event.toolCallId);
      return metadata === undefined
        ? undefined
        : {
            details: { ...recordOf(event.details), guard: metadata },
          };
    },
  );

  // Blocked calls skip tool_result but still produce a finalized message.
  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Pi owns the message union; the handler returns a replacement.
  pi.on("message_end", (event: Readonly<MessageEndEvent>) => {
    const { message } = event;
    if (message.role !== "toolResult") {
      return {};
    }
    // Keep skipped-hook decisions for the live renderer, whose result predates this message.
    const metadata = pending.get(message.toolCallId);
    return metadata === undefined
      ? undefined
      : {
          message: {
            ...message,
            details: { ...recordOf(message.details), guard: metadata },
          },
        };
  });

  pi.registerCommand("guard", {
    description: "Show or set the shell command guard (/guard [on|off])",
    handler: async (args: string, ctx: GuardContext) => {
      runGuardCommand(args, ctx, controller);
    },
  });
}
