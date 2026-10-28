import { expect, test } from "bun:test";
import { visibleWidth } from "@earendil-works/pi-tui";
import { renderStatusLine } from "../../src/statusline/render";
import type { FooterSnapshot, FooterTheme } from "../../src/statusline/render";

const theme: FooterTheme = {
  fg: (_color, text) => `\u001B[31m${text}\u001B[39m`,
  getThinkingBorderColor: () => (text) => `\u001B[35m${text}\u001B[39m`,
};

const snapshot: FooterSnapshot = {
  branch: "main",
  contextUsage: { contextWindow: 272_000, percent: 24, tokens: 65_280 },
  cwd: "中文目錄",
  model: {
    contextWindow: 272_000,
    id: "gpt-6.1-sol",
    provider: "openai",
    reasoning: true,
  },
  stats: { cost: 0.106, latestCacheHitRate: 48 },
  statuses: new Map([["guard", "guard off"]]),
  thinkingLevel: "medium",
};

test("ANSI-styled footer fits every width including context-only fallbacks", () => {
  for (let width = 0; width <= 160; width += 1) {
    const lines = renderStatusLine(snapshot, theme, width);
    expect(lines).toHaveLength(1);
    expect(visibleWidth(lines[0] ?? "")).toBeLessThanOrEqual(width);
  }
});
