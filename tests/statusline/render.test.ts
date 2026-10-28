import { expect, test } from "bun:test";
import { visibleWidth } from "@earendil-works/pi-tui";
import {
  createStatusFooter,
  renderStatusLine,
} from "../../src/statusline/render";
import type { FooterSnapshot, FooterTheme } from "../../src/statusline/render";

const contextWindow = 272_000;

const theme: FooterTheme = {
  fg: (_color, text) => text,
  getThinkingBorderColor: () => (text) => text,
};
function snapshot(): FooterSnapshot {
  return {
    branch: "main",
    contextUsage: { contextWindow, percent: 24, tokens: 65_280 },
    cwd: "parent/pi-tweaks",
    model: {
      contextWindow,
      id: "gpt-6.1-sol",
      provider: "openai",
      reasoning: true,
    },
    stats: { cost: 0.106, latestCacheHitRate: 48 },
    statuses: new Map([
      ["fast", "fast"],
      ["guard", "guard"],
    ]),
    thinkingLevel: "medium",
  };
}

test("renders one right-aligned line with the agreed groups", () => {
  const lines = renderStatusLine(snapshot(), theme, 140);
  expect(lines).toHaveLength(1);
  expect(lines[0]).toStartWith("pi-tweaks · main");
  expect(lines[0]).toEndWith(
    "(openai) gpt-6.1-sol · medium | $0.106 · ctx 24%/272k · hit 48% | guard · fast",
  );
  expect(visibleWidth(lines[0] ?? "")).toBe(140);
  expect(lines[0]).not.toContain("parent/");
});

test("keeps Guard ahead of generic statuses at narrow widths", () => {
  for (const width of [40, 60]) {
    const [line] = renderStatusLine(snapshot(), theme, width);
    expect(line).toContain("guard");
    expect(visibleWidth(line ?? "")).toBeLessThanOrEqual(width);
  }
});

test("drops optional metrics before losing model and context", () => {
  const [line] = renderStatusLine(snapshot(), theme, 55);
  expect(line).toContain("gpt-6.1-sol");
  expect(line).toContain("ctx 24%");
  expect(line).not.toContain("hit");
  expect(line).not.toContain("openai");
});

test("bounds every terminal width with Unicode, long identifiers, and external statuses", () => {
  const data = {
    ...snapshot(),
    branch: "很長的分支名稱",
    cwd: "中文目錄",
    statuses: new Map([["antigravity", "quota 82% 中文"]]),
  };
  for (let width = 0; width <= 160; width += 1) {
    const lines = renderStatusLine(data, theme, width);
    expect(lines).toHaveLength(1);
    expect(visibleWidth(lines[0] ?? "")).toBeLessThanOrEqual(width);
  }
});

test("sanitizes all external labels and retains generic extension statuses", () => {
  const data = {
    ...snapshot(),
    branch: "main\nbranch",
    cwd: "project\u0007",
    statuses: new Map([["antigravity", "quota\n82%\u001B[31m\u0007"]]),
  };
  const [line] = renderStatusLine(data, theme, 180);
  expect(line).toContain("main branch");
  expect(line).toContain("quota 82%");
  expect(line).not.toContain("\u0007");
  expect(line).not.toContain("\u001B");
});

test("unknown context never invents a zero capacity or percentage", () => {
  const data = {
    ...snapshot(),
    contextUsage: undefined,
    model: undefined,
    stats: { cost: 0, latestCacheHitRate: undefined },
    statuses: new Map<string, string>(),
  };
  const [line] = renderStatusLine(data, theme, 100);
  expect(line).toContain("no-model | ctx ?");
  expect(line).not.toContain("/0");
  expect(line).not.toContain("$");
  expect(line).not.toContain("hit");
});

function noop(): void {}

function expectContextColors(
  live: FooterTheme,
  colors: Readonly<ReadonlyMap<string, string>>,
): void {
  for (const [percent, color] of [
    [24, "muted"],
    [50, "warning"],
    [80, "error"],
  ] as const) {
    renderStatusLine(
      {
        ...snapshot(),
        contextUsage: { contextWindow, percent, tokens: 1000 },
      },
      live,
      300,
    );
    expect(colors.get(`${percent}%`)).toBe(color);
  }
}

test("evaluates context and thinking colors at render time and disposes once", () => {
  let listener = noop;
  let renders = 0;
  let disposed = 0;
  let prefix = "first";
  const colors = new Map<string, string>();
  const live: FooterTheme = {
    fg: (color, text) => {
      colors.set(text, color);
      return `${prefix}${text}`;
    },
    getThinkingBorderColor: (level) => (text) => {
      colors.set(text, level);
      return text;
    },
  };
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
    theme: live,
  });
  const first = footer.render(300);
  prefix = "second";
  footer.invalidate();
  expect(footer.render(300)).not.toEqual(first);
  expect(colors.get("medium")).toBe("medium");
  expectContextColors(live, colors);
  listener();
  footer.dispose();
  footer.dispose();
  listener();
  expect(renders).toBe(1);
  expect(disposed).toBe(1);
});
