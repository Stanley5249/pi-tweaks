import type {
  ExtensionAPI,
  ExtensionUIContext,
} from "@earendil-works/pi-coding-agent";

export type FastModel = Readonly<{
  provider: string;
}>;

export type FastContext = Readonly<{
  model?: FastModel | undefined;
  ui: Readonly<Pick<ExtensionUIContext, "notify" | "setStatus">>;
}>;

export type FastAPI = Readonly<Pick<ExtensionAPI, "on" | "registerCommand">>;

export type FastController = Readonly<{
  disable: (ctx: FastContext) => void;
  enable: (ctx: FastContext) => void;
  isEnabled: () => boolean;
  status: (ctx: FastContext) => void;
  sync: (ctx: FastContext) => void;
}>;

const supportedProviders = new Set(["openai-codex", "openai"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && Boolean(value) && !Array.isArray(value);
}

export function isFastModeSupported(provider?: string): boolean {
  return provider !== undefined && supportedProviders.has(provider);
}

export function rewriteFastModeRequest(
  payload: unknown,
  provider: string | undefined,
  enabled: boolean,
): unknown {
  if (!enabled || !isFastModeSupported(provider) || !isRecord(payload)) {
    return undefined;
  }
  return { ...payload, service_tier: "priority" };
}

export type FastState = Readonly<{
  get: () => boolean;
  set: (value: boolean) => void;
}>;

// pi replaces the extension runtime on /new, /resume, /fork, and /reload, so
// the choice lives on globalThis to last for the pi process.
const stateKey = Symbol.for("pi-tweaks.fast.enabled");

const processState: FastState = {
  get: () => Reflect.get(globalThis, stateKey) === true,
  set: (value) => {
    Reflect.set(globalThis, stateKey, value);
  },
};

export function createFastController(
  store: FastState = processState,
): FastController {
  let enabled = store.get();

  function sync(ctx: FastContext): void {
    ctx.ui.setStatus("fast", enabled ? "fast" : undefined);
  }

  function enable(ctx: FastContext): void {
    enabled = true;
    store.set(true);
    sync(ctx);
    ctx.ui.notify("OpenAI fast mode enabled (priority tier)", "info");
  }

  function disable(ctx: FastContext): void {
    enabled = false;
    store.set(false);
    sync(ctx);
    ctx.ui.notify("OpenAI fast mode disabled", "info");
  }

  function status(ctx: FastContext): void {
    const state = enabled ? "enabled" : "disabled";
    ctx.ui.notify(`OpenAI fast mode is ${state}`, "info");
  }

  return {
    disable,
    enable,
    isEnabled: () => enabled,
    status,
    sync,
  };
}

export function runFastCommand(
  args: string,
  ctx: FastContext,
  controller: FastController,
): void {
  const trimmed = args.trim().toLowerCase();
  switch (trimmed) {
    case "": {
      controller.status(ctx);
      break;
    }
    case "on": {
      controller.enable(ctx);
      break;
    }
    case "off": {
      controller.disable(ctx);
      break;
    }
    default: {
      ctx.ui.notify("Usage: /fast [on|off]", "error");
      break;
    }
  }
}

export default function fastExtension(pi: FastAPI): void {
  const controller = createFastController();

  pi.on("session_start", (_event: unknown, ctx: FastContext) => {
    controller.sync(ctx);
  });

  pi.on(
    "before_provider_request",
    (event: Readonly<{ payload: unknown }>, ctx: FastContext) =>
      rewriteFastModeRequest(
        event.payload,
        ctx.model?.provider,
        controller.isEnabled(),
      ),
  );

  pi.registerCommand("fast", {
    description: "Manage OpenAI fast mode (/fast [on|off])",
    handler: async (args: string, ctx: FastContext) => {
      runFastCommand(args, ctx, controller);
    },
  });
}
