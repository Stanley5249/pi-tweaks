import { expect, test } from "bun:test";
import { stripTerminalSequences, visibleWidth } from "@earendil-works/pi-tui";
import { renderStatusLine } from "../../src/status-line/render";
import type { FooterSnapshot } from "../../src/status-line/render";
import { collectUsage } from "../../src/status-line/stats";
import {
  createPalette,
  isFlavor,
  resolveFlavor,
} from "../../src/status-line/palette";

const kilo = 1000;
const cacheRead = 3000;
const contextWindow = 128_000;
const contextPercent = 25;
const testCost = 0.125;
const wideTerminal = 200;
const compactWidth = 8;

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

test("shows path, branch, session, usage, cache rate, model, and thinking", () => {
  const lines = renderStatusLine(
    snapshot(),
    createPalette("mocha"),
    wideTerminal,
  );
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

test("bounds narrow and Chinese footer rows", () => {
  const data = {
    ...snapshot(),
    cwd: "中文路徑",
    sessionName: "中文會話",
    statuses: ["中文狀態"],
  };
  for (const width of [0, 1, compactWidth, wideTerminal]) {
    const lines = renderStatusLine(data, createPalette("mocha"), width);
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
  const text = renderStatusLine(data, createPalette("mocha"), wideTerminal)
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
  const text = renderStatusLine(data, createPalette("mocha"), wideTerminal)
    .map((line) => stripTerminalSequences(line))
    .join("\n");
  expect(text).toContain("ctx ?/0");
  expect(text).toContain("no-model");
  expect(text).not.toContain("in ");
});

test("resolves Catppuccin flavors and defaults other themes to mocha", () => {
  expect(resolveFlavor("catppuccin-latte")).toBe("latte");
  expect(resolveFlavor("CATPPUCCIN-FRAPPE")).toBe("frappe");
  expect(resolveFlavor("catppuccin-macchiato")).toBe("macchiato");
  expect(resolveFlavor("dark")).toBe("mocha");
  expect(resolveFlavor()).toBe("mocha");
  expect(isFlavor("mocha")).toBe(true);
  expect(isFlavor("toString")).toBe(false);
});

test("creates flavor-specific terminal colors", () => {
  const mocha = createPalette("mocha").blue("中文");
  const latte = createPalette("latte").blue("中文");
  expect(mocha).toContain("\u001B[38;2;");
  expect(mocha).toContain("中文");
  expect(mocha).not.toBe(latte);
});
