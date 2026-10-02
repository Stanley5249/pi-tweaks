import { expect, test } from "bun:test";
import { initTheme } from "@earendil-works/pi-coding-agent";
import { stripTerminalSequences, visibleWidth } from "@earendil-works/pi-tui";
import { createPromptViewer } from "../../src/context/viewer";
import type { ViewerEnvironment } from "../../src/context/viewer";

initTheme("dark", false);
const defaultRows = 24;
const normalWidth = 80;
const narrowWidth = 2;
const compactHeight = 8;

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

test("invalidates rendering after a terminal resize", () => {
  const { state, viewer } = fixture("some text");
  viewer.render(normalWidth);
  state.rows = 1;
  viewer.invalidate();
  expect(viewer.render(normalWidth)).toHaveLength(1);
});

test("shows an empty-prompt placeholder", () => {
  const { state, viewer } = fixture();
  const text = viewer
    .render(normalWidth)
    .map((line) => stripTerminalSequences(line))
    .join("\n");
  expect(text).toContain("(Empty system prompt)");
  expect(state.closed).toBe(false);
});
