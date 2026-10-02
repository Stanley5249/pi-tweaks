import { expect, test } from "bun:test";
import { initTheme } from "@earendil-works/pi-coding-agent";
import { stripTerminalSequences, visibleWidth } from "@earendil-works/pi-tui";
import { createPromptViewer } from "../../src/context/viewer";
import type { ViewerEnvironment } from "../../src/context/viewer";

initTheme("dark", false);
const defaultRows = 24;
const lineCount = 40;
const normalWidth = 80;
const narrowWidth = 2;
const compactHeight = 8;
const bodyAndFooterRows = 4;
const bodyAndHeaderRows = 6;

function fixture(prompt = "", rows = defaultRows) {
  const state = {
    closed: false,
    copied: false,
    dumped: false,
    rendered: false,
    rows,
  };
  const environment: ViewerEnvironment = {
    chat: () => {
      state.dumped = true;
    },
    close: () => {
      state.closed = true;
    },
    copy: async () => {
      state.copied = true;
    },
    getRows: () => state.rows,
    onError: () => {},
    requestRender: () => {
      state.rendered = true;
    },
    theme: { bold: (text) => text, fg: (_color, text) => text },
  };
  const viewer = createPromptViewer(
    { promptCharCount: prompt.length, systemPrompt: prompt },
    environment,
  );
  return { state, viewer };
}

function longPrompt(): string {
  return Array.from(
    { length: lineCount },
    (_line, index) => `line ${index}`,
  ).join("\n");
}

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

test("keeps prompt content visible even when chrome must be omitted", () => {
  for (const rows of [1, narrowWidth, bodyAndFooterRows, bodyAndHeaderRows]) {
    const { viewer } = fixture("PROMPT BODY", rows);
    const text = viewer
      .render(normalWidth)
      .map((line) => stripTerminalSequences(line))
      .join("\n");
    expect(text).toContain("PROMPT BODY");
    expect(text).not.toContain("Row 1-0");
  }
});

test("clamps scrolling and forwards the configured wheel delta", () => {
  const { state, viewer } = fixture(longPrompt());
  viewer.render(normalWidth);
  viewer.handleInput?.("j");
  expect(state.rendered).toBe(true);
  expect(viewer.render(normalWidth).at(-1)).toContain("Row 2-");
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
  expect(viewer.render(normalWidth).at(-1)).toContain("100%");
  viewer.handleInput?.("g");
  viewer.handleInput?.("k");
  expect(viewer.render(normalWidth).at(-1)).toContain("Row 1-");
});

test("supports taller view, resize, page navigation, and invalidation", () => {
  const { state, viewer } = fixture(longPrompt());
  const original = viewer.render(normalWidth).length;
  viewer.handleInput?.("f");
  expect(viewer.render(normalWidth).length).toBeGreaterThan(original);
  viewer.handleInput?.(" ");
  expect(viewer.render(normalWidth).at(-1)).not.toContain("Row 1-");
  viewer.handleInput?.("b");
  expect(viewer.render(normalWidth).at(-1)).toContain("Row 1-");
  state.rows = 1;
  viewer.invalidate();
  expect(viewer.render(normalWidth)).toHaveLength(1);
});

test("reveals navigation and size details only when help is requested", () => {
  const { state, viewer } = fixture("PROMPT BODY");
  const renderText = () =>
    viewer
      .render(normalWidth)
      .map((line) => stripTerminalSequences(line))
      .join("\n");
  expect(renderText()).toContain("tokens (estimate)");
  expect(renderText()).not.toContain("j/k line");
  viewer.handleInput?.("?");
  expect(state.rendered).toBe(true);
  expect(renderText()).toContain("j/k line");
  expect(renderText()).toContain("context estimate not recorded");
  expect(renderText()).toContain("PROMPT BODY");
  viewer.handleInput?.("?");
  expect(renderText()).not.toContain("j/k line");
});

test("copies without closing and dumps to chat before closing", async () => {
  const { state, viewer } = fixture();
  viewer.handleInput?.("c");
  await Promise.resolve();
  expect(state.copied).toBe(true);
  expect(state.closed).toBe(false);
  viewer.handleInput?.("\r");
  expect(state.dumped).toBe(true);
  expect(state.closed).toBe(true);
});

test("shows an empty-prompt placeholder and closes without a chat entry", () => {
  const { state, viewer } = fixture();
  const text = viewer
    .render(normalWidth)
    .map((line) => stripTerminalSequences(line))
    .join("\n");
  expect(text).toContain("(Empty system prompt)");
  viewer.handleInput?.("q");
  expect(state.closed).toBe(true);
  expect(state.dumped).toBe(false);
});
