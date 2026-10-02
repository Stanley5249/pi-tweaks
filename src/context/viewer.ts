import { highlightCode } from "@earendil-works/pi-coding-agent";
import type { Theme } from "@earendil-works/pi-coding-agent";
import {
  ScrollView,
  Text,
  truncateToWidth,
  visibleWidth,
} from "@earendil-works/pi-tui";
import type { Component } from "@earendil-works/pi-tui";
import {
  formatModel,
  formatPromptSizeEstimate,
  sanitizeForTerminal,
  sanitizeSingleLine,
} from "./data";
import type { ContextDumpData } from "./data";

const horizontalPadding = 2;
const expandedMargin = 4;
const compactThreshold = 8;
const compactChrome = 2;
const fullChrome = 6;
const percentScale = 100;

type ViewerTheme = Readonly<Pick<Theme, "bold" | "fg">>;
export type ViewerEnvironment = Readonly<{
  chat: () => void;
  close: () => void;
  copy: () => Promise<void>;
  getRows: () => number;
  onError: (error: unknown) => void;
  requestRender: () => void;
  theme: ViewerTheme;
}>;

function renderHeader(
  data: Readonly<ContextDumpData>,
  theme: ViewerTheme,
  width: number,
): string {
  const title = theme.bold(theme.fg("accent", " [System Prompt] "));
  const thinking =
    data.thinkingLevel === undefined || data.thinkingLevel === ""
      ? ""
      : ` (${sanitizeSingleLine(data.thinkingLevel)})`;
  const left = title + theme.fg("muted", formatModel(data) + thinking);
  const right = data.usage
    ? theme.fg(
        "dim",
        `${data.usage.tokens?.toLocaleString() ?? "?"} / ${data.usage.contextWindow.toLocaleString()} tok (${data.usage.percent?.toFixed(1) ?? "?"}%) `,
      )
    : "";
  const padding = Math.max(0, width - visibleWidth(left) - visibleWidth(right));
  return truncateToWidth(left + " ".repeat(padding) + right, width, "");
}

class PromptViewer implements Component {
  private readonly content: Text;
  private readonly viewport: ScrollView;
  private readonly safePrompt: string;
  private readonly data: Readonly<ContextDumpData>;
  private readonly environment: ViewerEnvironment;
  private readonly expanded = false;

  constructor(data: Readonly<ContextDumpData>, environment: ViewerEnvironment) {
    this.data = data;
    this.environment = environment;
    this.safePrompt =
      sanitizeForTerminal(data.systemPrompt) || "(Empty system prompt)";
    this.content = new Text("", horizontalPadding, 0);
    this.viewport = new ScrollView(this.content, {
      overscroll: "contain",
      scrollbar: "hidden",
    });
    this.invalidate();
  }

  invalidate(): void {
    this.content.setText(highlightCode(this.safePrompt, "markdown").join("\n"));
    this.viewport.invalidate();
  }

  private renderChrome(width: number, compact: boolean): string[] {
    const { theme } = this.environment;
    const lines = [renderHeader(this.data, theme, width)];
    if (!compact) {
      lines.push(
        theme.fg(
          "dim",
          `  Prompt ${this.data.promptCharCount.toLocaleString()} chars | ${formatPromptSizeEstimate(this.data)}`,
        ),
        theme.fg(
          "dim",
          "  Navigate  [Up/Down/j/k] Line  [b/Space] Page  [g/G] Ends",
        ),
        theme.fg(
          "dim",
          `  Actions   [q/Esc] Close  [f] ${this.expanded ? "Shorter" : "Taller"}  [c] Copy  [d/Enter] Chat`,
        ),
        theme.fg("dim", "─".repeat(width)),
      );
    }
    return lines;
  }

  render(width: number): string[] {
    const rows = Math.max(1, this.environment.getRows());
    const targetHeight = Math.min(
      rows,
      Math.max(
        1,
        this.expanded
          ? rows - expandedMargin
          : Math.floor(rows / horizontalPadding),
      ),
    );
    const compact = targetHeight < compactThreshold;
    const bodyHeight = Math.max(
      0,
      targetHeight - (compact ? compactChrome : fullChrome),
    );
    const body = this.viewport.render(width);
    this.viewport.updateLayout(
      body.length,
      bodyHeight,
      this.environment.requestRender,
    );
    const lines = this.renderChrome(width, compact);
    lines.push(
      ...body.slice(
        this.viewport.scrollTop,
        this.viewport.scrollTop + bodyHeight,
      ),
    );
    while (lines.length < targetHeight - 1) {
      lines.push("");
    }
    const maximum = Math.max(0, body.length - bodyHeight);
    const progress =
      maximum === 0
        ? "All"
        : `${Math.round((this.viewport.scrollTop / maximum) * percentScale)}%`;
    lines.push(
      this.environment.theme.fg(
        "dim",
        ` q close | Row ${this.viewport.scrollTop + 1}-${Math.min(this.viewport.scrollTop + bodyHeight, body.length)} of ${body.length} (${progress}) `,
      ),
    );
    return lines
      .slice(0, targetHeight)
      .map((line) => truncateToWidth(line, width, ""));
  }
}

export function createPromptViewer(
  data: Readonly<ContextDumpData>,
  environment: ViewerEnvironment,
): Component {
  return new PromptViewer(data, environment);
}
