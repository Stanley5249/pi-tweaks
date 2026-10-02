import { expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { initTheme } from "@earendil-works/pi-coding-agent";
import { stripTerminalSequences, visibleWidth } from "@earendil-works/pi-tui";
import contextExtension, {
  renderContextCard,
  runContextCommand,
} from "../../src/context/index";
import type { ContextAPI, ContextCommandSource } from "../../src/context/index";

initTheme("dark", false);
const width = 80;

function fixture() {
  const entries: unknown[] = [];
  const notifications: { message: string; type: string | undefined }[] = [];
  const registered: string[] = [];
  const api: ContextAPI = {
    appendEntry: (name, data) => {
      entries.push({ data, name });
    },
    registerCommand: (name) => {
      registered.push(name);
    },
    registerEntryRenderer: (name) => {
      registered.push(name);
    },
  };
  const ctx: ContextCommandSource = {
    cwd: import.meta.dir,
    getContextUsage: () => {},
    getSystemPrompt: () => "raw prompt\u001B[31m",
    getSystemPromptOptions: () => ({}),
    mode: "print",
    ui: {
      custom: async () => {
        throw new Error("Custom UI is unavailable");
      },
      notify: (message, type) => {
        notifications.push({ message, type });
      },
    },
  };
  return { api, ctx, entries, notifications, registered };
}

test("registers only the context command and snapshot renderer", () => {
  const { api, registered } = fixture();
  contextExtension(api);
  expect(registered).toEqual(["context-dump", "context"]);
});

test("rejects invalid commands before reading the prompt", async () => {
  const state = fixture();
  await runContextCommand(
    "unknown",
    {
      ...state.ctx,
      getSystemPrompt: () => {
        throw new Error("Invalid commands must not read the prompt");
      },
    },
    state.api,
  );
  expect(state.entries).toHaveLength(0);
  expect(state.notifications.at(-1)?.type).toBe("error");
});

test("uses a durable entry rather than terminal UI in headless modes", async () => {
  const state = fixture();
  await runContextCommand("", state.ctx, state.api);
  expect(state.entries).toMatchObject([
    { data: { systemPrompt: "raw prompt\u001B[31m" }, name: "context-dump" },
  ]);
  expect(state.notifications.at(-1)?.type).toBe("info");
});

test("copies the raw prompt without adding a chat entry", async () => {
  const state = fixture();
  let copied = "";
  await runContextCommand("copy", state.ctx, {
    ...state.api,
    copy: async (text) => {
      copied = text;
    },
  });
  expect(copied).toBe("raw prompt\u001B[31m");
  expect(state.entries).toHaveLength(0);
  expect(state.notifications.at(-1)?.type).toBe("info");
});

test("reports clipboard failures", async () => {
  const state = fixture();
  await runContextCommand("copy", state.ctx, {
    ...state.api,
    copy: async () => {
      throw new Error("No clipboard");
    },
  });
  expect(state.notifications.at(-1)?.type).toBe("error");
});

test("saves the raw prompt relative to the command working directory", async () => {
  const state = fixture();
  const cwd = await mkdtemp(join(import.meta.dir, ".save-"));
  try {
    await runContextCommand(
      "save prompt snapshot.md",
      { ...state.ctx, cwd },
      state.api,
    );
    expect(await readFile(join(cwd, "prompt snapshot.md"), "utf8")).toBe(
      "raw prompt\u001B[31m",
    );
    expect(state.notifications.at(-1)?.type).toBe("info");
  } finally {
    await rm(cwd, { force: true, recursive: true });
  }
});

test("reports save errors without adding a chat entry", async () => {
  const state = fixture();
  await runContextCommand(
    "save missing-directory/prompt.md",
    state.ctx,
    state.api,
  );
  expect(state.notifications.at(-1)?.type).toBe("error");
  expect(state.entries).toHaveLength(0);
});

test("keeps expanded cards within narrow terminal widths", () => {
  const smallWidth = 2;
  const compactWidth = 8;
  const theme = {
    bg: (_color: string, text: string) => text,
    bold: (text: string) => text,
    fg: (_color: string, text: string) => text,
  };
  const data = { promptCharCount: 0, systemPrompt: "中文內容" };
  for (const terminalWidth of [1, smallWidth, compactWidth, width]) {
    const lines = renderContextCard(data, true, theme).render(terminalWidth);
    for (const line of lines) {
      expect(visibleWidth(line)).toBeLessThanOrEqual(terminalWidth);
    }
  }
});

test("renders a missing snapshot without throwing", () => {
  const theme = {
    bg: (_color: string, text: string) => text,
    bold: (text: string) => text,
    fg: (_color: string, text: string) => text,
  };
  expect(
    renderContextCard(undefined, false, theme).render(width).join("").trimEnd(),
  ).toBe("No prompt data");
});

test("expands cards only on request and sanitizes terminal content", () => {
  const data = { promptCharCount: 0, systemPrompt: "private prompt\u0007" };
  const theme = {
    bg: (_color: string, text: string) => text,
    bold: (text: string) => text,
    fg: (_color: string, text: string) => text,
  };
  const collapsed = renderContextCard(data, false, theme)
    .render(width)
    .join("\n");
  const expanded = renderContextCard(data, true, theme)
    .render(width)
    .map((line) => stripTerminalSequences(line))
    .join("\n");
  expect(collapsed).not.toContain("private prompt");
  expect(expanded).toContain("private prompt");
  expect(expanded).not.toContain("\u0007");
});
