import { expect, test } from "bun:test";
import contextExtension, { runContextCommand } from "../../src/context/index";
import type { ContextAPI, ContextCommandSource } from "../../src/context/index";

function fixture(mode: ContextCommandSource["mode"] = "print") {
  const notifications: Readonly<{
    message: string;
    type: string | undefined;
  }>[] = [];
  const state = { copied: "", opened: false };
  const ctx: ContextCommandSource = {
    getSystemPrompt: () => "raw prompt\u001B[31m",
    mode,
    ui: {
      custom: async () => {
        state.opened = true;
        throw new Error("The stub cannot render a viewer");
      },
      notify: (message, type) => {
        notifications.push({ message, type });
      },
    },
  };
  const copy = async (text: string) => {
    state.copied = text;
  };
  return { copy, ctx, notifications, state };
}

test("registers only the context command", () => {
  const registered: string[] = [];
  const api: ContextAPI = {
    registerCommand: (name) => {
      registered.push(name);
    },
  };
  contextExtension(api);
  expect(registered).toEqual(["context"]);
});

test("rejects removed and unknown actions before reading the prompt", async () => {
  const { copy, ctx, notifications } = fixture("tui");
  const invalid = ["chat", "save", "view extra", "unknown"];
  await Promise.all(
    invalid.map(async (args) =>
      runContextCommand(
        args,
        {
          ...ctx,
          getSystemPrompt: () => {
            throw new Error("Invalid commands must not read the prompt");
          },
        },
        copy,
      ),
    ),
  );
  expect(notifications.map((item) => item.message)).toEqual(
    invalid.map(() => "Usage: /context [view|copy]"),
  );
});

async function opensViewer(args: string): Promise<boolean> {
  const { copy, ctx, state } = fixture("tui");
  try {
    await runContextCommand(args, ctx, copy);
  } catch {
    // The stub UI throws after recording that the viewer opened.
  }
  return state.opened;
}

test("opens the viewer by default in the TUI", async () => {
  expect(await opensViewer("")).toBe(true);
  expect(await opensViewer(" VIEW ")).toBe(true);
});

test("points headless modes to copy instead of opening the viewer", async () => {
  const { copy, ctx, notifications } = fixture();
  await runContextCommand("", ctx, copy);
  expect(notifications.at(-1)?.type).toBe("error");
  expect(notifications.at(-1)?.message).toContain("/context copy");
});

test("copies the raw prompt", async () => {
  const { copy, ctx, notifications, state } = fixture();
  await runContextCommand("copy", ctx, copy);
  expect(state.copied).toBe("raw prompt\u001B[31m");
  expect(notifications.at(-1)?.type).toBe("info");
});

test("reports clipboard failures", async () => {
  const { ctx, notifications } = fixture();
  await runContextCommand("copy", ctx, async () => {
    throw new Error("No clipboard");
  });
  expect(notifications.at(-1)?.type).toBe("error");
});
