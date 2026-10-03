import type {
  ContextUsage,
  ExtensionContext,
  Theme,
  ThemeColor,
} from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import type { Component } from "@earendil-works/pi-tui";
import { sanitizeSingleLine } from "../terminal";
import { formatCwd, formatTokens } from "./stats";
import type { UsageStats } from "./stats";

// Pi does not export ThinkingLevel from its package index.
export type ThinkingLevel = NonNullable<ExtensionContext["thinkingLevel"]>;
export type FooterTheme = Readonly<
  Pick<Theme, "bold" | "fg" | "getThinkingBorderColor">
>;
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
  thinkingLevel?: ThinkingLevel | undefined;
}>;

function metric(
  theme: FooterTheme,
  label: string,
  [color, value]: readonly [ThemeColor, string],
): string {
  return `${theme.fg("dim", label)} ${theme.fg(color, value)}`;
}

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
  // The path shrinks first so the branch stays visible.
  const branchText =
    branch === "" ? "" : ` ${theme.fg("muted", `(${branch})`)}`;
  const pathWidth = Math.max(0, width - visibleWidth(branchText));
  const path = theme.bold(theme.fg("text", truncateToWidth(cwd, pathWidth)));
  const line = `${path}${branchText}`;
  if (session === "") {
    return line;
  }
  const full = `${line} ${theme.fg("dim", "·")} ${theme.fg("muted", session)}`;
  return visibleWidth(full) <= width ? full : line;
}

function renderStats(snapshot: FooterSnapshot, theme: FooterTheme): string[] {
  const { stats } = snapshot;
  const count = (label: string, value: number): string =>
    value > 0 ? metric(theme, label, ["muted", formatTokens(value)]) : "";
  const cost =
    stats.cost > 0
      ? `${theme.fg("dim", "$")}${theme.fg("muted", stats.cost.toFixed(costPrecision))}`
      : "";
  const hasCache = stats.cacheRead > 0 || stats.cacheWrite > 0;
  const rate = stats.latestCacheHitRate;
  const hit =
    hasCache && rate !== undefined
      ? metric(theme, "hit", ["muted", `${rate.toFixed(0)}%`])
      : "";
  // Narrow rows drop stats from the end, so this order is their priority.
  return [
    cost,
    count("in", stats.input),
    count("out", stats.output),
    hit,
    count("read", stats.cacheRead),
    count("write", stats.cacheWrite),
  ].filter((part) => part !== "");
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
  const compact = metric(theme, "ctx", [contextColor(percent ?? 0), display]);
  return [`${compact}${theme.fg("dim", `/${formatTokens(window)}`)}`, compact];
}

function renderModel(
  snapshot: FooterSnapshot,
  theme: FooterTheme,
): Readonly<{ name: string; variants: readonly string[] }> {
  const model = sanitizeSingleLine(snapshot.model?.id ?? "") || "no-model";
  const provider = sanitizeSingleLine(snapshot.model?.provider ?? "");
  const name = theme.bold(theme.fg("accent", model));
  const parts = [name];
  if (snapshot.model?.reasoning === true) {
    const level = snapshot.thinkingLevel ?? "off";
    // Match the editor border, which uses the same theme helper.
    const color = theme.getThinkingBorderColor(level);
    parts.push(`${theme.fg("dim", "·")} ${color(level)}`);
  }
  const thinking = parts.join(" ");
  const full =
    provider === ""
      ? thinking
      : `${theme.fg("dim", `(${provider})`)} ${thinking}`;
  return { name, variants: [full, thinking, name] };
}

function joinSides(left: string, right: string, width: number): string {
  const gap = Math.max(
    minimumGap,
    width - visibleWidth(left) - visibleWidth(right),
  );
  return `${left}${" ".repeat(gap)}${right}`;
}

function renderUsageRow(
  snapshot: FooterSnapshot,
  theme: FooterTheme,
  width: number,
): string {
  const { name, variants } = renderModel(snapshot, theme);
  const nameWidth = visibleWidth(name);
  const contexts = renderContext(snapshot, theme);
  const context =
    contexts.find(
      (text) => nameWidth + minimumGap + visibleWidth(text) <= width,
    ) ?? contexts[1];
  const modelWidth = Math.max(0, width - visibleWidth(context) - minimumGap);
  const model =
    variants.find((text) => visibleWidth(text) <= modelWidth) ??
    truncateToWidth(name, modelWidth);
  const stats = renderStats(snapshot, theme);
  const separator = theme.fg("dim", " · ");
  const right = (): string => [...stats, context].join(separator);
  const budget = width - visibleWidth(model) - minimumGap;
  while (stats.length > 0 && visibleWidth(right()) > budget) {
    stats.pop();
  }
  return joinSides(model, right(), width);
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
