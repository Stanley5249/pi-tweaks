import { expect, test } from "bun:test";
import { initTheme } from "@earendil-works/pi-coding-agent";
import { stripTerminalSequences, visibleWidth } from "@earendil-works/pi-tui";
import { createPromptViewer, formatCount } from "../../src/context/viewer";
import type { ViewerEnvironment } from "../../src/context/viewer";

initTheme("dark", false);
const defaultRows = 24;
const lineCount = 40;
const normalWidth = 80;
const narrowWidth = 2;
const compactHeight = 8;
const bodyAndFooterRows = 4;
const bodyAndHeaderRows = 6;
const shortRows = [1, narrowWidth, bodyAndFooterRows, bodyAndHeaderRows];

function fixture(prompt = "", rows = defaultRows) {
  const state = { closed: false, copied: false, rendered: false, rows };
  const environment: ViewerEnvironment = {
    close: () => {
      state.closed = true;
    },
    copy: async () => {
      state.copied = true;
    },
    getRows: () => state.rows,
    requestRender: () => {
      state.rendered = true;
    },
    theme: { bold: (text) => text, fg: (_color, text) => text },
  };
  const viewer = createPromptViewer(prompt, environment);
  const lines = () =>
    viewer.render(normalWidth).map((line) => stripTerminalSequences(line));
  const text = () => lines().join("\n");
  const footer = () => lines().at(-1) ?? "";
  return { footer, state, text, viewer };
}

function longPrompt(): string {
  return Array.from(
    { length: lineCount },
    (_line, index) => `line ${index}`,
  ).join("\n");
}

test("formats counts compactly", () => {
  const samples = {
    "1.2k": 1234,
    "2.5M": 2_500_000,
    "57k": 56_789,
    "999": 999,
  };
  for (const [label, count] of Object.entries(samples)) {
    expect(formatCount(count)).toBe(label);
  }
});

test("keeps narrow and Chinese content within the terminal dimensions", () => {
  for (const rows of [1, narrowWidth, compactHeight, defaultRows]) {
    for (const width of [1, narrowWidth, compactHeight, normalWidth]) {
      const { viewer } = fixture("中文\u001B[31m內容\u001B[0m\n下一行", rows);
      const lines = viewer.render(width);
      expect(lines.length).toBeLessThanOrEqual(rows);
      for (const line of lines) {
        expect(visibleWidth(line)).toBeLessThanOrEqual(width);
      }
    }
  }
});

test("shows the title, size, and short key hints", () => {
  const { footer, text } = fixture("PROMPT BODY");
  expect(text()).toContain("System prompt · 11 chars");
  expect(footer()).toContain("q close · c copy · t taller · ? keys");
  expect(footer()).toContain("1-1 / 1");
});

test("keeps prompt content visible even when chrome must be omitted", () => {
  for (const rows of shortRows) {
    const { text } = fixture("PROMPT BODY", rows);
    expect(text()).toContain("PROMPT BODY");
    expect(text()).not.toContain("1-0 /");
  }
});

test("toggles the full key list", () => {
  const { state, text, viewer } = fixture("PROMPT BODY");
  expect(text()).not.toContain("half page");
  viewer.handleInput?.("?");
  expect(state.rendered).toBe(true);
  expect(text()).toContain("half page");
  expect(text()).toContain("PROMPT BODY");
  viewer.handleInput?.("?");
  expect(text()).not.toContain("half page");
});

test("scrolls by line, half page, page, and ends", () => {
  const { footer, viewer } = fixture(longPrompt());
  viewer.render(normalWidth);
  viewer.handleInput?.("j");
  expect(footer()).toStartWith(" q close");
  expect(footer()).toContain("2-");
  viewer.handleInput?.("k");
  viewer.handleInput?.("d");
  expect(footer()).not.toContain("1-");
  viewer.handleInput?.("u");
  expect(footer()).toContain("1-");
  viewer.handleInput?.("f");
  expect(footer()).not.toContain("1-");
  viewer.handleInput?.("b");
  expect(footer()).toContain("1-");
  viewer.handleInput?.("G");
  expect(footer()).toContain(`-${lineCount} / ${lineCount}`);
  viewer.handleInput?.("g");
  expect(footer()).toContain("1-");
});

test("forwards the configured wheel delta", () => {
  const { footer, viewer } = fixture(longPrompt());
  viewer.render(normalWidth);
  viewer.handleMouse?.({
    alt: false,
    button: "none",
    ctrl: false,
    height: defaultRows,
    screenX: 0,
    screenY: 0,
    shift: false,
    type: "wheel",
    wheelDelta: lineCount,
    width: normalWidth,
    x: 0,
    y: 0,
  });
  expect(footer()).toContain(`-${lineCount} / ${lineCount}`);
});

test("supports taller view, resize, and invalidation", () => {
  const { footer, state, viewer } = fixture(longPrompt());
  const original = viewer.render(normalWidth).length;
  viewer.handleInput?.("t");
  expect(viewer.render(normalWidth).length).toBeGreaterThan(original);
  expect(footer()).toContain("t shorter");
  state.rows = 1;
  viewer.invalidate();
  expect(viewer.render(normalWidth)).toHaveLength(1);
});

test("copies without closing and closes on q", async () => {
  const { state, viewer } = fixture();
  viewer.handleInput?.("c");
  await Promise.resolve();
  expect(state.copied).toBe(true);
  expect(state.closed).toBe(false);
  viewer.handleInput?.("q");
  expect(state.closed).toBe(true);
});

test("shows an empty-prompt placeholder", () => {
  const { text } = fixture();
  expect(text()).toContain("(Empty system prompt)");
});
