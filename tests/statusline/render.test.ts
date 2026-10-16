import { expect, test } from "bun:test";
import { visibleWidth } from "@earendil-works/pi-tui";
import {
  createStatusFooter,
  renderStatusLine,
} from "../../src/statusline/render";
import type { FooterSnapshot, FooterTheme } from "../../src/statusline/render";
import { collectUsage } from "../../src/statusline/stats";

const theme: FooterTheme = {
  bold: (text) => text,
  fg: (_color, text) => text,
  getThinkingBorderColor: () => (text) => text,
};

const contextWindow = 128_000;
const contextPercent = 25;
const wideTerminal = 200;
const normalWidth = 80;
const narrowWidth = 24;

function snapshot(): FooterSnapshot {
  return {
    branch: "main",
    contextUsage: { contextWindow, percent: contextPercent, tokens: 1000 },
    cwd: "project",
    model: {
      contextWindow,
      id: "model",
      provider: "provider",
      reasoning: true,
    },
    sessionName: "session",
    stats: collectUsage([
      {
        message: {
          role: "assistant",
          usage: {
            cacheRead: 3000,
            cost: { total: 0.125 },
            input: 1000,
            output: 1000,
          },
        },
        type: "message",
      },
    ]),
    statuses: [],
    thinkingLevel: "high",
  };
}

function noOperation(): void {}

test("uses live theme helpers and disposes the branch subscription once", () => {
  let listener = noOperation;
  let color = "31";
  const liveTheme: FooterTheme = {
    bold: (text) => text,
    fg: (_token, text) => `\u001B[${color}m${text}\u001B[39m`,
    getThinkingBorderColor: () => (text) => text,
  };
  let renders = 0;
  let disposed = 0;
  const footer = createStatusFooter(snapshot, {
    onBranchChange: (handler) => {
      listener = handler;
      return () => {
        disposed += 1;
      };
    },
    requestRender: () => {
      renders += 1;
    },
    theme: liveTheme,
  });
  const before = footer.render(wideTerminal).join("");
  color = "32";
  footer.invalidate();
  expect(footer.render(wideTerminal).join("")).not.toBe(before);
  listener();
  footer.dispose();
  footer.dispose();
  listener();
  expect(disposed).toBe(1);
  expect(renders).toBe(1);
});

test("shows path, branch, session, usage, cache rate, model, and thinking", () => {
  const text = renderStatusLine(snapshot(), theme, wideTerminal).join("\n");
  expect(text).toContain("project (main)");
  expect(text).toContain("session");
  expect(text).toContain("in 1.0k");
  expect(text).toContain("hit 75%");
  expect(text).toContain("$0.125");
  expect(text).toContain("ctx 25%/128k");
  expect(text).toContain("(provider) model");
  expect(text).toContain("high");
});

test("preserves model and context before secondary metrics", () => {
  const data = {
    ...snapshot(),
    model: {
      contextWindow,
      id: "gemini-3-pro",
      provider: "google-antigravity",
      reasoning: true,
    },
    stats: {
      ...snapshot().stats,
      cacheRead: 300_000,
      cacheWrite: 120_000,
      input: 120_000,
    },
  };
  const [, normal] = renderStatusLine(data, theme, normalWidth);
  expect(normal).toContain("gemini-3-pro");
  expect(normal).toContain("ctx 25%/128k");
  expect(normal).not.toContain("read ");
  const [, narrow] = renderStatusLine(data, theme, narrowWidth);
  expect(narrow).toContain("gemini-3-pro");
  expect(narrow).toContain("ctx 25%");
  expect(narrow).not.toContain("high");
  expect(narrow).not.toContain("hit ");
});

test("shortens long paths before hiding the branch", () => {
  const data = {
    ...snapshot(),
    cwd: "a/very/long/path/that/would/otherwise/hide/the/branch",
  };
  const [top] = renderStatusLine(data, theme, 32);
  expect(top).toContain("(main)");
  expect(top).not.toContain("session");
});

test("bounds narrow and Chinese footer rows", () => {
  const data = {
    ...snapshot(),
    cwd: "中文路徑",
    sessionName: "中文會話",
    statuses: ["中文狀態"],
  };
  for (const width of [0, 1, 8, wideTerminal]) {
    const lines = renderStatusLine(data, theme, width);
    for (const line of lines) {
      expect(visibleWidth(line)).toBeLessThanOrEqual(width);
    }
  }
});

test("sanitizes external text and keeps extension statuses visible", () => {
  const data = {
    ...snapshot(),
    branch: "main\nbranch",
    cwd: "project\u0007",
    sessionName: "\u001B[31msession\u001B[0m",
    statuses: ["tool\nstatus\u0007"],
  };
  const text = renderStatusLine(data, theme, wideTerminal).join("\n");
  expect(text).toContain("main branch");
  expect(text).toContain("tool status");
  expect(text).not.toContain("\u0007");
});

test("shows unknown context and no-model without invented usage", () => {
  const data = {
    ...snapshot(),
    contextUsage: undefined,
    model: undefined,
    stats: collectUsage([]),
  };
  const text = renderStatusLine(data, theme, wideTerminal).join("\n");
  expect(text).toContain("ctx ?/0");
  expect(text).toContain("no-model");
  expect(text).not.toContain("in ");
});

test("reserves warning colors for context pressure", () => {
  expect(recordColors(snapshot()).get("model")).toBe("accent");
  const cases = [
    [contextPercent, "muted"],
    [50, "warning"],
    [80, "error"],
  ] as const;
  for (const [percent, color] of cases) {
    const colors = recordColors({
      ...snapshot(),
      contextUsage: { contextWindow, percent, tokens: 1000 },
    });
    expect(colors.get(`${percent}%`)).toBe(color);
  }
});

function recordColors(data: FooterSnapshot): Map<string, string> {
  const colors = new Map<string, string>();
  const recordingTheme: FooterTheme = {
    bold: (text) => text,
    fg: (color, text) => {
      colors.set(text, color);
      return text;
    },
    getThinkingBorderColor: (level) => (text) => {
      colors.set(text, `thinking:${level}`);
      return text;
    },
  };
  renderStatusLine(data, recordingTheme, wideTerminal);
  return colors;
}

test("colors thinking levels like the editor border", () => {
  expect(recordColors(snapshot()).get("high")).toBe("thinking:high");
  const off = recordColors({ ...snapshot(), thinkingLevel: undefined });
  expect(off.get("off")).toBe("thinking:off");
});

test("dims metric labels", () => {
  const colors = recordColors(snapshot());
  expect(colors.get("hit")).toBe("dim");
  expect(colors.get("75%")).toBe("muted");
});
