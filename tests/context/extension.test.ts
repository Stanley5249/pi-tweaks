import { expect, test } from "bun:test";
import { initTheme } from "@earendil-works/pi-coding-agent";
import { stripTerminalSequences, visibleWidth } from "@earendil-works/pi-tui";
import { renderContextCard } from "../../src/context/index";

initTheme("dark", false);
const width = 80;

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
