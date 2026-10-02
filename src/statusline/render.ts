import type { ContextUsage } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { sanitizeSingleLine } from "../terminal";
import { bold, createPalette, resolveFlavor } from "./palette";
import type { Palette, PaletteColor } from "./palette";
import { formatCwd, formatTokens } from "./stats";
import type { UsageStats } from "./stats";

import type { Component } from "@earendil-works/pi-tui";

export type FooterEnvironment = Readonly<{
  getThemeName: () => string | undefined;
  onBranchChange: (callback: () => void) => () => void;
  requestRender: () => void;
}>;

const contextWarning = 50;
const contextCritical = 80;
const goodCacheHit = 70;
const moderateCacheHit = 30;
const costPrecision = 3;
const minimumGap = 2;
const thinkingColors: Readonly<Record<string, PaletteColor>> = {
  high: "mauve",
  low: "blue",
  max: "red",
  medium: "lavender",
  minimal: "teal",
  off: "surface2",
  xhigh: "peach",
};

export type StatusModel = Readonly<{
  contextWindow: number;
  id: string;
  provider: string;
  reasoning: boolean;
}>;
export type FooterSnapshot = Readonly<{
  branch: string | null;
  contextUsage?: Readonly<ContextUsage> | undefined;
  cwd: string;
  home?: string | undefined;
  model?: StatusModel | undefined;
  sessionName?: string | undefined;
  stats: UsageStats;
  statuses: readonly string[];
  thinkingLevel?: string | undefined;
}>;

function cacheColor(rate: number): PaletteColor {
  if (rate >= goodCacheHit) {
    return "green";
  }
  if (rate >= moderateCacheHit) {
    return "yellow";
  }
  return "subtext0";
}

function contextColor(percent: number): PaletteColor {
  if (percent >= contextCritical) {
    return "red";
  }
  if (percent >= contextWarning) {
    return "peach";
  }
  return "teal";
}

function renderTop(snapshot: FooterSnapshot, palette: Palette): string {
  const cwd = sanitizeSingleLine(formatCwd(snapshot.cwd, snapshot.home));
  const branch = sanitizeSingleLine(snapshot.branch ?? "");
  const session = sanitizeSingleLine(snapshot.sessionName ?? "");
  const parts = [palette.blue(bold(cwd))];
  if (branch !== "") {
    parts.push(palette.mauve(bold(`(${branch})`)));
  }
  if (session !== "") {
    parts.push(`${palette.surface2("•")} ${palette.peach(bold(session))}`);
  }
  return parts.join(" ");
}

function renderStats(snapshot: FooterSnapshot, palette: Palette): string {
  const { stats } = snapshot;
  const parts: string[] = [];
  const counts: readonly (readonly [string, number, PaletteColor])[] = [
    ["in", stats.input, "sky"],
    ["out", stats.output, "teal"],
    ["read", stats.cacheRead, "green"],
    ["write", stats.cacheWrite, "peach"],
  ];
  for (const [label, count, color] of counts) {
    if (count > 0) {
      parts.push(
        `${palette.subtext0(label)} ${palette[color](formatTokens(count))}`,
      );
    }
  }
  if (
    (stats.cacheRead > 0 || stats.cacheWrite > 0) &&
    stats.latestCacheHitRate !== undefined
  ) {
    const rate = stats.latestCacheHitRate;
    parts.push(
      `${palette.subtext0("hit")} ${palette[cacheColor(rate)](`${rate.toFixed(0)}%`)}`,
    );
  }
  if (stats.cost > 0) {
    parts.push(
      `${palette.subtext0("$")}${palette.yellow(stats.cost.toFixed(costPrecision))}`,
    );
  }
  const percent = snapshot.contextUsage?.percent;
  const display =
    percent === undefined || percent === null ? "?" : `${percent.toFixed(0)}%`;
  const window =
    snapshot.contextUsage?.contextWindow ?? snapshot.model?.contextWindow ?? 0;
  parts.push(
    `${palette.subtext0("ctx")} ${palette[contextColor(percent ?? 0)](display)}${palette.overlay1(`/${formatTokens(window)}`)}`,
  );
  return parts.join(` ${palette.surface2("•")} `);
}

function renderModel(snapshot: FooterSnapshot, palette: Palette): string {
  const model = sanitizeSingleLine(snapshot.model?.id ?? "") || "no-model";
  const provider = sanitizeSingleLine(snapshot.model?.provider ?? "");
  const parts: string[] = [];
  if (provider !== "") {
    parts.push(palette.overlay1(`(${provider})`));
  }
  parts.push(palette.lavender(bold(model)));
  if (snapshot.model?.reasoning === true) {
    const level = sanitizeSingleLine(snapshot.thinkingLevel ?? "off");
    const color = thinkingColors[level] ?? "red";
    parts.push(`${palette.surface2("•")} ${palette[color](level)}`);
  }
  return parts.join(" ");
}

export function createStatusFooter(
  read: () => FooterSnapshot,
  environment: FooterEnvironment,
): Component & { dispose: () => void } {
  let disposed = false;
  let palette = createPalette(resolveFlavor(environment.getThemeName()));
  const unsubscribe = environment.onBranchChange(() => {
    if (!disposed) {
      environment.requestRender();
    }
  });
  return {
    dispose() {
      if (!disposed) {
        disposed = true;
        unsubscribe();
      }
    },
    invalidate() {
      palette = createPalette(resolveFlavor(environment.getThemeName()));
    },
    render(width) {
      return renderStatusLine(read(), palette, width);
    },
  };
}

export function renderStatusLine(
  snapshot: FooterSnapshot,
  palette: Palette,
  width: number,
): string[] {
  const top = renderTop(snapshot, palette);
  const left = renderStats(snapshot, palette);
  const right = renderModel(snapshot, palette);
  const gap = Math.max(
    minimumGap,
    width - visibleWidth(left) - visibleWidth(right),
  );
  const lines = [top, `${left}${" ".repeat(gap)}${right}`];
  if (snapshot.statuses.length > 0) {
    const statuses = snapshot.statuses
      .map((text) => sanitizeSingleLine(text))
      .join(" ");
    lines.push(palette.subtext1(statuses));
  }
  return lines.map((line) => truncateToWidth(line, width));
}
