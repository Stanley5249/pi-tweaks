import { expect, test } from "bun:test";
import { stripTerminalSequences, visibleWidth } from "@earendil-works/pi-tui";
import {
  createStatusFooter,
  renderStatusLine,
} from "../../src/statusline/render";
import type { FooterSnapshot, FooterTheme } from "../../src/statusline/render";
import { collectUsage } from "../../src/statusline/stats";

const theme: FooterTheme = { bold: (text) => text, fg: (_color, text) => text };

const kilo = 1000;
const cacheRead = 3000;
const contextWindow = 128_000;
const contextPercent = 25;
const testCost = 0.125;
const wideTerminal = 200;
const compactWidth = 8;
const normalWidth = 80;
const narrowWidth = 24;
const pathWidth = 32;

function snapshot(): FooterSnapshot {
  return {
    branch: "main",
    contextUsage: { contextWindow, percent: contextPercent, tokens: kilo },
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
            cacheRead,
            cost: { total: testCost },
            input: kilo,
            output: kilo,
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
  const lines = renderStatusLine(snapshot(), theme, wideTerminal);
  const text = lines.map((line) => stripTerminalSequences(line)).join("\n");
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
  const normal = stripTerminalSequences(
    renderStatusLine(data, theme, normalWidth).at(1) ?? "",
  );
  expect(normal).toContain("gemini-3-pro");
  expect(normal).toContain("ctx 25%/128k");
  expect(normal).not.toContain("read ");
  const narrow = stripTerminalSequences(
    renderStatusLine(data, theme, narrowWidth).at(1) ?? "",
  );
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
  const top = stripTerminalSequences(
    renderStatusLine(data, theme, pathWidth).at(0) ?? "",
  );
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
  for (const width of [0, 1, compactWidth, wideTerminal]) {
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
  const text = renderStatusLine(data, theme, wideTerminal)
    .map((line) => stripTerminalSequences(line))
    .join("\n");
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
  const text = renderStatusLine(data, theme, wideTerminal)
    .map((line) => stripTerminalSequences(line))
    .join("\n");
  expect(text).toContain("ctx ?/0");
  expect(text).toContain("no-model");
  expect(text).not.toContain("in ");
});

test("reserves warning colors for context pressure", () => {
  const colors: string[] = [];
  const recordingTheme: FooterTheme = {
    bold: (text) => text,
    fg: (color, text) => {
      colors.push(color);
      return text;
    },
  };
  renderStatusLine(snapshot(), recordingTheme, wideTerminal);
  expect(colors).toContain("accent");
  expect(colors).not.toContain("warning");
  expect(colors).not.toContain("error");
  const warningPercent = 50;
  renderStatusLine(
    {
      ...snapshot(),
      contextUsage: { contextWindow, percent: warningPercent, tokens: kilo },
    },
    recordingTheme,
    wideTerminal,
  );
  expect(colors).toContain("warning");
  const criticalPercent = 80;
  renderStatusLine(
    {
      ...snapshot(),
      contextUsage: { contextWindow, percent: criticalPercent, tokens: kilo },
    },
    recordingTheme,
    wideTerminal,
  );
  expect(colors).toContain("error");
});
