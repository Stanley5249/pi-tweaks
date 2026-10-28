import { basename } from "node:path";
import type {
  ContextUsage,
  ExtensionContext,
  Theme,
  ThemeColor,
} from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import type { Component } from "@earendil-works/pi-tui";
import { sanitizeSingleLine } from "../terminal";
import { formatTokens } from "./stats";
import type { UsageStats } from "./stats";

// Pi does not export ThinkingLevel from its package index.
export type ThinkingLevel = NonNullable<ExtensionContext["thinkingLevel"]>;
export type FooterTheme = Readonly<
  Pick<Theme, "fg" | "getThinkingBorderColor">
>;
export type FooterEnvironment = Readonly<{
  onBranchChange: (callback: () => void) => () => void;
  requestRender: () => void;
  theme: FooterTheme;
}>;
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
  model?: StatusModel | undefined;
  stats: UsageStats;
  statuses: Readonly<ReadonlyMap<string, string>>;
  thinkingLevel?: ThinkingLevel | undefined;
}>;

const contextWarning = 50;
const contextCritical = 80;
const costPrecision = 3;
const minimumGap = 2;
const groupSeparator = " | ";

type DisplayField =
  | "cost"
  | "fast"
  | "hit"
  | "provider"
  | "statuses"
  | "thinking"
  | "window";
// Narrow rows drop fields in this order.
const dropOrder: readonly DisplayField[] = [
  "hit",
  "provider",
  "window",
  "cost",
  "statuses",
  "thinking",
  "fast",
];

type RenderParts = Readonly<{
  context: string;
  fast: string;
  guard: string;
  left: string;
  model: string;
  otherStatuses: readonly string[];
  provider: string;
  separator: string;
  snapshot: FooterSnapshot;
  theme: FooterTheme;
  window: number | undefined;
}>;

function renderStatuses(
  statuses: Readonly<ReadonlyMap<string, string>>,
  theme: FooterTheme,
): Readonly<{ fast: string; guard: string; other: readonly string[] }> {
  const visible = [...statuses]
    .map(
      ([key, text]: readonly [string, string]) =>
        [key, sanitizeSingleLine(text)] as const,
    )
    .filter(([, text]) => text !== "")
    .toSorted(([first], [second]) => first.localeCompare(second));
  const fast = visible.find(([key]) => key === "fast");
  const guard = visible.find(([key]) => key === "guard");
  return {
    fast: fast === undefined ? "" : theme.fg("muted", fast[1]),
    guard: guard === undefined ? "" : theme.fg("muted", guard[1]),
    other: visible
      .filter(([key]) => key !== "guard" && key !== "fast")
      .map(([, text]) => theme.fg("muted", text)),
  };
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

function renderContext(snapshot: FooterSnapshot, theme: FooterTheme): string {
  const percent = snapshot.contextUsage?.percent;
  const value =
    percent === undefined || percent === null ? "?" : `${percent.toFixed(0)}%`;
  return `${theme.fg("dim", "ctx")} ${theme.fg(contextColor(percent ?? 0), value)}`;
}

function prepareParts(
  snapshot: FooterSnapshot,
  theme: FooterTheme,
): RenderParts {
  const muted = (text: string): string => theme.fg("muted", text);
  const separator = theme.fg("dim", " · ");
  const branch = sanitizeSingleLine(snapshot.branch ?? "");
  const left = [
    muted(sanitizeSingleLine(basename(snapshot.cwd) || snapshot.cwd)),
    branch === "" ? "" : muted(branch),
  ]
    .filter(Boolean)
    .join(separator);
  const statuses = renderStatuses(snapshot.statuses, theme);
  return {
    context: renderContext(snapshot, theme),
    fast: statuses.fast,
    guard: statuses.guard,
    left,
    model: muted(sanitizeSingleLine(snapshot.model?.id ?? "") || "no-model"),
    otherStatuses: statuses.other,
    provider: sanitizeSingleLine(snapshot.model?.provider ?? ""),
    separator,
    snapshot,
    theme,
    window:
      snapshot.contextUsage?.contextWindow ?? snapshot.model?.contextWindow,
  };
}

function renderModel(
  parts: RenderParts,
  shown: Readonly<ReadonlySet<DisplayField>>,
): string {
  const { fast, model, provider, separator, snapshot, theme } = parts;
  let text = model;
  if (shown.has("provider") && provider !== "") {
    text = `${theme.fg("dim", `(${provider})`)} ${text}`;
  }
  if (shown.has("thinking") && snapshot.model?.reasoning === true) {
    const level = snapshot.thinkingLevel ?? "off";
    // Match the editor border, which uses the same theme helper.
    text += `${separator}${theme.getThinkingBorderColor(level)(level)}`;
  }
  if (shown.has("fast") && fast !== "") {
    text += `${separator}${fast}`;
  }
  return text;
}

function renderMetrics(
  parts: RenderParts,
  shown: Readonly<ReadonlySet<DisplayField>>,
): string {
  const { context, separator, snapshot, theme, window } = parts;
  const dim = (text: string): string => theme.fg("dim", text);
  const muted = (text: string): string => theme.fg("muted", text);
  const metrics: string[] = [];
  if (shown.has("cost") && snapshot.stats.cost > 0) {
    metrics.push(muted(`$${snapshot.stats.cost.toFixed(costPrecision)}`));
  }
  metrics.push(
    shown.has("window") && window !== undefined && window > 0
      ? `${context}${dim(`/${formatTokens(window)}`)}`
      : context,
  );
  const rate = snapshot.stats.latestCacheHitRate;
  if (shown.has("hit") && rate !== undefined) {
    metrics.push(`${dim("hit")} ${muted(`${rate.toFixed(0)}%`)}`);
  }
  return metrics.join(separator);
}

function renderRight(
  parts: RenderParts,
  shown: Readonly<ReadonlySet<DisplayField>>,
): string {
  const statuses = [
    parts.guard,
    ...(shown.has("statuses") ? parts.otherStatuses : []),
  ].filter(Boolean);
  const groups = [renderModel(parts, shown), renderMetrics(parts, shown)];
  if (statuses.length > 0) {
    groups.push(statuses.join(parts.separator));
  }
  return groups.join(parts.theme.fg("dim", groupSeparator));
}

// Keep the model, context, and guard when even the minimal fields overflow.
function renderTinyLine(parts: RenderParts, width: number): string {
  const divider = parts.theme.fg("dim", groupSeparator);
  const guard = parts.guard === "" ? "" : `${divider}${parts.guard}`;
  const core = `${parts.model}${divider}${parts.context}${guard}`;
  if (visibleWidth(core) <= width) {
    const left = truncateToWidth(
      parts.left,
      Math.max(0, width - visibleWidth(core) - minimumGap),
    );
    const gap = Math.max(0, width - visibleWidth(left) - visibleWidth(core));
    return `${left}${" ".repeat(gap)}${core}`;
  }
  const context = `${parts.context}${guard}`;
  const modelWidth = width - visibleWidth(context) - visibleWidth(divider);
  if (visibleWidth(context) > width) {
    if (parts.guard === "") {
      return truncateToWidth(parts.context, width);
    }
    const guardWidth = visibleWidth(parts.guard);
    if (guardWidth >= width) {
      return truncateToWidth(parts.guard, width);
    }
    const contextWidth = width - guardWidth - visibleWidth(divider);
    return contextWidth > 0
      ? `${truncateToWidth(parts.context, contextWidth)}${divider}${parts.guard}`
      : parts.guard;
  }
  if (modelWidth <= 0) {
    return context;
  }
  return `${truncateToWidth(parts.model, modelWidth)}${divider}${context}`;
}

export function renderStatusLine(
  snapshot: FooterSnapshot,
  theme: FooterTheme,
  width: number,
): string[] {
  const parts = prepareParts(snapshot, theme);
  const shown = new Set<DisplayField>(dropOrder);
  const room = Math.max(0, width - minimumGap);
  let right = renderRight(parts, shown);
  for (const field of dropOrder) {
    if (visibleWidth(right) <= room) {
      break;
    }
    shown.delete(field);
    right = renderRight(parts, shown);
  }
  if (visibleWidth(right) > room) {
    return [renderTinyLine(parts, width)];
  }
  const left = truncateToWidth(
    parts.left,
    Math.max(0, width - visibleWidth(right) - minimumGap),
  );
  const gap = width - visibleWidth(left) - visibleWidth(right);
  return [`${left}${" ".repeat(gap)}${right}`];
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
