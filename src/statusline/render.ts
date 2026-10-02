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

function renderTop(
  snapshot: FooterSnapshot,
  palette: Palette,
  width: number,
): string {
  const cwd = sanitizeSingleLine(formatCwd(snapshot.cwd, snapshot.home));
  const branch = sanitizeSingleLine(snapshot.branch ?? "");
  const session = sanitizeSingleLine(snapshot.sessionName ?? "");
  const branchText = branch === "" ? "" : palette.mauve(bold(`(${branch})`));
  const pathWidth = Math.max(
    0,
    width - visibleWidth(branchText) - (branchText === "" ? 0 : 1),
  );
  const path = palette.blue(bold(truncateToWidth(cwd, pathWidth)));
  const parts = [path, branchText].filter((part) => part !== "");
  const sessionText = `${palette.surface2("•")} ${palette.peach(bold(session))}`;
  if (
    session !== "" &&
    visibleWidth([...parts, sessionText].join(" ")) <= width
  ) {
    parts.push(sessionText);
  }
  return parts.join(" ");
}

function renderStats(snapshot: FooterSnapshot, palette: Palette): string[] {
  const { stats } = snapshot;
  const parts: string[] = [];
  if (stats.cost > 0) {
    parts.push(
      `${palette.subtext0("$")}${palette.yellow(stats.cost.toFixed(costPrecision))}`,
    );
  }
  const counts: readonly (readonly [string, number, PaletteColor])[] = [
    ["in", stats.input, "sky"],
    ["out", stats.output, "teal"],
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
  for (const [label, count] of [
    ["read", stats.cacheRead],
    ["write", stats.cacheWrite],
  ] as const) {
    if (count > 0) {
      parts.push(
        `${palette.subtext0(label)} ${palette.subtext1(formatTokens(count))}`,
      );
    }
  }
  return parts;
}

function renderContext(
  snapshot: FooterSnapshot,
  palette: Palette,
): readonly [string, string] {
  const percent = snapshot.contextUsage?.percent;
  const display =
    percent === undefined || percent === null ? "?" : `${percent.toFixed(0)}%`;
  const window =
    snapshot.contextUsage?.contextWindow ?? snapshot.model?.contextWindow ?? 0;
  const compact = `${palette.subtext0("ctx")} ${palette[contextColor(percent ?? 0)](display)}`;
  return [`${compact}${palette.overlay1(`/${formatTokens(window)}`)}`, compact];
}

function renderModel(
  snapshot: FooterSnapshot,
  palette: Palette,
): readonly string[] {
  const model = sanitizeSingleLine(snapshot.model?.id ?? "") || "no-model";
  const provider = sanitizeSingleLine(snapshot.model?.provider ?? "");
  const name = palette.lavender(bold(model));
  const parts = [name];
  if (snapshot.model?.reasoning === true) {
    const level = sanitizeSingleLine(snapshot.thinkingLevel ?? "off");
    const color = thinkingColors[level] ?? "red";
    parts.push(`${palette.surface2("•")} ${palette[color](level)}`);
  }
  const thinking = parts.join(" ");
  const full =
    provider === ""
      ? thinking
      : `${palette.overlay1(`(${provider})`)} ${thinking}`;
  return [full, thinking, name];
}

function joinSides(left: string, right: string, width: number): string {
  const gap = Math.max(
    minimumGap,
    width - visibleWidth(left) - visibleWidth(right),
  );
  return truncateToWidth(`${left}${" ".repeat(gap)}${right}`, width);
}

function renderUsageRow(
  snapshot: FooterSnapshot,
  palette: Palette,
  width: number,
): string {
  const models = renderModel(snapshot, palette);
  const name = models.at(-1) ?? "";
  const contexts = renderContext(snapshot, palette);
  const context =
    contexts.find(
      (text) => visibleWidth(name) + minimumGap + visibleWidth(text) <= width,
    ) ??
    contexts.at(-1) ??
    "";
  const modelWidth = Math.max(0, width - visibleWidth(context) - minimumGap);
  const model =
    models.find((text) => visibleWidth(text) <= modelWidth) ??
    truncateToWidth(name, modelWidth);
  const stats = renderStats(snapshot, palette);
  const separator = ` ${palette.surface2("•")} `;
  while (
    stats.length > 0 &&
    visibleWidth(model) +
      minimumGap +
      visibleWidth([...stats, context].join(separator)) >
      width
  ) {
    stats.pop();
  }
  const right = [...stats, context].join(separator);
  return joinSides(model, right, width);
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
  const top = renderTop(snapshot, palette, width);
  const lines = [top, renderUsageRow(snapshot, palette, width)];
  if (snapshot.statuses.length > 0) {
    const statuses = snapshot.statuses
      .map((text) => sanitizeSingleLine(text))
      .join(" ");
    lines.push(palette.subtext1(statuses));
  }
  return lines.map((line) => truncateToWidth(line, width));
}
