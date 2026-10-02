import type { ContextUsage, ThemeColor } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import type { Component } from "@earendil-works/pi-tui";
import { sanitizeSingleLine } from "../terminal";
import type { FooterTheme } from "./palette";
import { formatCwd, formatTokens } from "./stats";
import type { UsageStats } from "./stats";

export type FooterEnvironment = Readonly<{
  onBranchChange: (callback: () => void) => () => void;
  requestRender: () => void;
  theme: FooterTheme;
}>;

const contextWarning = 50;
const contextCritical = 80;
const costPrecision = 3;
const minimumGap = 2;

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

function contextColor(percent: number): ThemeColor {
  if (percent >= contextCritical) {
    return "error";
  }
  if (percent >= contextWarning) {
    return "warning";
  }
  return "muted";
}

function renderTop(
  snapshot: FooterSnapshot,
  theme: FooterTheme,
  width: number,
): string {
  const cwd = sanitizeSingleLine(formatCwd(snapshot.cwd, snapshot.home));
  const branch = sanitizeSingleLine(snapshot.branch ?? "");
  const session = sanitizeSingleLine(snapshot.sessionName ?? "");
  const branchText = branch === "" ? "" : theme.fg("muted", `(${branch})`);
  const pathWidth = Math.max(
    0,
    width - visibleWidth(branchText) - (branchText === "" ? 0 : 1),
  );
  const path = theme.fg("muted", truncateToWidth(cwd, pathWidth));
  const parts = [path, branchText].filter((part) => part !== "");
  const sessionText = theme.fg("muted", `· ${session}`);
  if (
    session !== "" &&
    visibleWidth([...parts, sessionText].join(" ")) <= width
  ) {
    parts.push(sessionText);
  }
  return parts.join(" ");
}

function renderStats(snapshot: FooterSnapshot, theme: FooterTheme): string[] {
  const { stats } = snapshot;
  const parts: string[] = [];
  if (stats.cost > 0) {
    parts.push(theme.fg("muted", `$${stats.cost.toFixed(costPrecision)}`));
  }
  for (const [label, count] of [
    ["in", stats.input],
    ["out", stats.output],
  ] as const) {
    if (count > 0) {
      parts.push(theme.fg("muted", `${label} ${formatTokens(count)}`));
    }
  }
  if (
    (stats.cacheRead > 0 || stats.cacheWrite > 0) &&
    stats.latestCacheHitRate !== undefined
  ) {
    parts.push(
      theme.fg("muted", `hit ${stats.latestCacheHitRate.toFixed(0)}%`),
    );
  }
  for (const [label, count] of [
    ["read", stats.cacheRead],
    ["write", stats.cacheWrite],
  ] as const) {
    if (count > 0) {
      parts.push(theme.fg("muted", `${label} ${formatTokens(count)}`));
    }
  }
  return parts;
}

function renderContext(
  snapshot: FooterSnapshot,
  theme: FooterTheme,
): readonly [string, string] {
  const percent = snapshot.contextUsage?.percent;
  const display =
    percent === undefined || percent === null ? "?" : `${percent.toFixed(0)}%`;
  const window =
    snapshot.contextUsage?.contextWindow ?? snapshot.model?.contextWindow ?? 0;
  const compact = `${theme.fg("muted", "ctx")} ${theme.fg(contextColor(percent ?? 0), display)}`;
  return [
    `${compact}${theme.fg("muted", `/${formatTokens(window)}`)}`,
    compact,
  ];
}

function renderModel(
  snapshot: FooterSnapshot,
  theme: FooterTheme,
): readonly string[] {
  const model = sanitizeSingleLine(snapshot.model?.id ?? "") || "no-model";
  const provider = sanitizeSingleLine(snapshot.model?.provider ?? "");
  const name = theme.bold(theme.fg("accent", model));
  const parts = [name];
  if (snapshot.model?.reasoning === true) {
    const level = sanitizeSingleLine(snapshot.thinkingLevel ?? "off");
    parts.push(theme.fg("muted", `· ${level}`));
  }
  const thinking = parts.join(" ");
  const full =
    provider === ""
      ? thinking
      : `${theme.fg("muted", `(${provider})`)} ${thinking}`;
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
  theme: FooterTheme,
  width: number,
): string {
  const models = renderModel(snapshot, theme);
  const name = models.at(-1) ?? "";
  const contexts = renderContext(snapshot, theme);
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
  const stats = renderStats(snapshot, theme);
  const separator = theme.fg("dim", " · ");
  while (
    stats.length > 0 &&
    visibleWidth(model) +
      minimumGap +
      visibleWidth([...stats, context].join(separator)) >
      width
  ) {
    stats.pop();
  }
  return joinSides(model, [...stats, context].join(separator), width);
}

export function createStatusFooter(
  read: () => FooterSnapshot,
  environment: FooterEnvironment,
): Component & { dispose: () => void } {
  let disposed = false;
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
    // Theme helpers are evaluated on render, so no styled strings are cached.
    invalidate() {},
    render(width) {
      return renderStatusLine(read(), environment.theme, width);
    },
  };
}

export function renderStatusLine(
  snapshot: FooterSnapshot,
  theme: FooterTheme,
  width: number,
): string[] {
  const lines = [
    renderTop(snapshot, theme, width),
    renderUsageRow(snapshot, theme, width),
  ];
  if (snapshot.statuses.length > 0) {
    const statuses = snapshot.statuses
      .map((text) => sanitizeSingleLine(text))
      .join(" ");
    lines.push(theme.fg("muted", statuses));
  }
  return lines.map((line) => truncateToWidth(line, width));
}
