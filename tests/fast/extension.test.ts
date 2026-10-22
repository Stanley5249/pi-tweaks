import { expect, test } from "bun:test";
import fastExtension, {
  createFastController,
  isFastModeSupported,
  rewriteFastModeRequest,
  runFastCommand,
} from "../../src/fast/index";
import type { FastAPI, FastContext, FastState } from "../../src/fast/index";

function memoryState(): FastState {
  let value = false;
  return {
    get: () => value,
    set: (next) => {
      value = next;
    },
  };
}

type Notifications = { message: string; type: string | undefined }[];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && Boolean(value) && !Array.isArray(value);
}

function createTestContext(provider?: string): {
  ctx: FastContext;
  state: {
    notifications: Notifications;
    statuses: Record<string, string | undefined>;
  };
} {
  const state: {
    notifications: Notifications;
    statuses: Record<string, string | undefined>;
  } = {
    notifications: [],
    statuses: {},
  };

  const ctx: FastContext = {
    model:
      provider === undefined
        ? undefined
        : {
            provider,
          },
    ui: {
      notify: (message, type) => {
        state.notifications.push({ message, type });
      },
      setStatus: (key, text) => {
        state.statuses[key] = text;
      },
    },
  };

  return { ctx, state };
}

test("provider support checks only OpenAI providers", () => {
  expect(isFastModeSupported("openai-codex")).toBe(true);
  expect(isFastModeSupported("openai")).toBe(true);
  expect(isFastModeSupported("antigravity")).toBe(false);
  expect(isFastModeSupported("anthropic")).toBe(false);
  expect(isFastModeSupported()).toBe(false);
});

test("starts disabled and reports status without changing state", () => {
  const { ctx, state } = createTestContext("openai-codex");
  const controller = createFastController(memoryState());

  expect(controller.isEnabled()).toBe(false);

  controller.status(ctx);
  expect(controller.isEnabled()).toBe(false);
  expect(state.notifications.at(-1)?.message).toBe(
    "OpenAI fast mode is disabled",
  );
});

test("explicit enable and disable manage state", () => {
  const { ctx, state } = createTestContext("openai-codex");
  const controller = createFastController(memoryState());

  controller.enable(ctx);
  expect(controller.isEnabled()).toBe(true);
  expect(state.statuses["fast"]).toBe("fast");
  expect(state.notifications.at(-1)?.message).toContain("enabled");

  controller.status(ctx);
  expect(state.notifications.at(-1)?.message).toBe(
    "OpenAI fast mode is enabled",
  );

  controller.disable(ctx);
  expect(controller.isEnabled()).toBe(false);
  expect(state.statuses["fast"]).toBeUndefined();
  expect(state.notifications.at(-1)?.message).toContain("disabled");
});

test("runFastCommand handles empty input as status, on, off, and rejects aliases", () => {
  const { ctx, state } = createTestContext("openai-codex");
  const controller = createFastController(memoryState());

  runFastCommand("", ctx, controller);
  expect(controller.isEnabled()).toBe(false);
  expect(state.notifications.at(-1)?.message).toBe(
    "OpenAI fast mode is disabled",
  );

  runFastCommand("on", ctx, controller);
  expect(controller.isEnabled()).toBe(true);

  runFastCommand("", ctx, controller);
  expect(state.notifications.at(-1)?.message).toBe(
    "OpenAI fast mode is enabled",
  );

  runFastCommand("off", ctx, controller);
  expect(controller.isEnabled()).toBe(false);

  runFastCommand("enable", ctx, controller);
  expect(state.notifications.at(-1)?.message).toBe("Usage: /fast [on|off]");
  expect(state.notifications.at(-1)?.type).toBe("error");

  runFastCommand("status", ctx, controller);
  expect(state.notifications.at(-1)?.message).toBe("Usage: /fast [on|off]");
  expect(state.notifications.at(-1)?.type).toBe("error");
});

test("rewriteFastModeRequest injects priority service tier only when enabled and supported", () => {
  const payload = { messages: [], model: "gpt-6-sol" };
  const arrayPayload = [0, 1];

  expect(
    rewriteFastModeRequest(payload, "openai-codex", false),
  ).toBeUndefined();
  expect(rewriteFastModeRequest(payload, "antigravity", true)).toBeUndefined();
  expect(rewriteFastModeRequest("str", "openai-codex", true)).toBeUndefined();
  expect(
    rewriteFastModeRequest(arrayPayload, "openai-codex", true),
  ).toBeUndefined();

  const rewritten = rewriteFastModeRequest(payload, "openai-codex", true);
  expect(rewritten).toBeDefined();
  if (isRecord(rewritten)) {
    expect(rewritten["service_tier"]).toBe("priority");
    expect(rewritten["model"]).toBe("gpt-6-sol");
  }
});

test("fastExtension registers command and event listeners", () => {
  const commands: string[] = [];
  const events: string[] = [];

  const fakePi: FastAPI = {
    on: (event: string) => {
      events.push(event);
      return () => {};
    },
    registerCommand: (name: string) => {
      commands.push(name);
    },
  };

  fastExtension(fakePi);

  expect(commands).toContain("fast");
  expect(events).toContain("session_start");
  expect(events).toContain("before_provider_request");
});

test("a new controller keeps the state of the previous runtime", () => {
  const { ctx } = createTestContext("openai-codex");
  const state = memoryState();
  createFastController(state).enable(ctx);
  expect(createFastController(state).isEnabled()).toBe(true);
});
