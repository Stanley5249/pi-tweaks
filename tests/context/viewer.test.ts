import { expect, test } from "bun:test";
import { initTheme } from "@earendil-works/pi-coding-agent";
import { stripTerminalSequences, visibleWidth } from "@earendil-works/pi-tui";
import { createPromptViewer, formatCount } from "../../src/context/viewer";
import type { ViewerEnvironment } from "../../src/context/viewer";

initTheme("dark", false);
const defaultRows = 24;
const lineCount = 40;
const normalWidth = 80;
const wideWidth = 120;
const narrowHeader = 41;
// Tag markers count as visible text, so the tagged header needs extra room.
const taggedWidth = 400;
const narrowWidth = 2;
const compactHeight = 8;
const bodyAndFooterRows = 4;
const bodyAndHeaderRows = 6;
const shortRows = [1, narrowWidth, bodyAndFooterRows, bodyAndHeaderRows];

type Fg = ViewerEnvironment["theme"]["fg"];
const plain: Fg = (_color, text) => text;
const tagged: Fg = (color, text) => `<${color}>${text}`;

function fixture(prompt = "", rows = defaultRows, fg = plain) {
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
    theme: { bold: (text) => text, fg },
  };
  const viewer = createPromptViewer(prompt, environment);
  const lines = (width = normalWidth) =>
    viewer.render(width).map((line) => stripTerminalSequences(line));
  const text = () => lines().join("\n");
  const header = (width = normalWidth) => lines(width)[0] ?? "";
  return { header, state, text, viewer };
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

test("shows the title and the keys that fit on the top ruler", () => {
  const { header } = fixture("PROMPT BODY");
  expect(header()).toBe(
    "── System prompt · 11 chars · 1-1 / 1 ─────────── q close · c copy · t taller ──",
  );
  expect(header(wideWidth)).toEndWith(
    "─ q close · c copy · t taller · j/k line · d/u half · f/b page · g/G ends ──",
  );
  expect(header(narrowHeader)).toBe(
    "── System prompt · 11 chars · 1-1 / 1 ───",
  );
  for (const width of [normalWidth, wideWidth, narrowHeader]) {
    expect(visibleWidth(header(width))).toBe(width);
  }
});

test("colors keys apart from their labels", () => {
  const { header } = fixture("PROMPT BODY", defaultRows, tagged);
  expect(header(taggedWidth)).toContain(
    "<accent>q<muted> close<dim> · <accent>c",
  );
});

test("keeps prompt content visible even when chrome must be omitted", () => {
  for (const rows of shortRows) {
    const { text } = fixture("PROMPT BODY", rows);
    expect(text()).toContain("PROMPT BODY");
    expect(text()).not.toContain("1-0 /");
  }
});

test("scrolls by line, half page, page, and ends", () => {
  const { header, viewer } = fixture(longPrompt());
  viewer.render(normalWidth);
  viewer.handleInput?.("j");
  expect(header()).toContain(" · 2-");
  viewer.handleInput?.("k");
  viewer.handleInput?.("d");
  expect(header()).not.toContain(" · 1-");
  viewer.handleInput?.("u");
  expect(header()).toContain(" · 1-");
  viewer.handleInput?.("f");
  expect(header()).not.toContain(" · 1-");
  viewer.handleInput?.("b");
  expect(header()).toContain(" · 1-");
  viewer.handleInput?.("G");
  expect(header()).toContain(`-${lineCount} / ${lineCount}`);
  viewer.handleInput?.("g");
  expect(header()).toContain(" · 1-");
});

test("forwards the configured wheel delta", () => {
  const { header, viewer } = fixture(longPrompt());
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
  expect(header()).toContain(`-${lineCount} / ${lineCount}`);
});

test("supports taller view, resize, and invalidation", () => {
  const { header, state, viewer } = fixture(longPrompt());
  const original = viewer.render(normalWidth).length;
  viewer.handleInput?.("t");
  expect(viewer.render(normalWidth).length).toBeGreaterThan(original);
  expect(header()).toContain("t shorter");
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
