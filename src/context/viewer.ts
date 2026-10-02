import { highlightCode } from "@earendil-works/pi-coding-agent";
import type { Theme } from "@earendil-works/pi-coding-agent";
import {
  ScrollView,
  Text,
  matchesKey,
  truncateToWidth,
  visibleWidth,
} from "@earendil-works/pi-tui";
import type {
  Component,
  KeyId,
  TuiMouseEvent,
  TuiMouseEventResult,
} from "@earendil-works/pi-tui";
import {
  formatModel,
  formatPromptSizeEstimate,
  formatPromptSummary,
} from "./data";
import { sanitizeForTerminal, sanitizeSingleLine } from "../terminal";
import type { ContextDumpData } from "./data";

const horizontalPadding = 2;
const expandedMargin = 4;
const compactThreshold = 8;
const compactChrome = 2;
const fullChrome = 4;
const helpChrome = 3;
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

function isKey(input: string, ...keys: readonly KeyId[]): boolean {
  return keys.some((key) => matchesKey(input, key));
}

function renderHeader(
  data: Readonly<ContextDumpData>,
  theme: ViewerTheme,
  width: number,
): string {
  const title = theme.bold(theme.fg("accent", " System prompt "));
  const thinking =
    data.thinkingLevel === undefined || data.thinkingLevel === ""
      ? ""
      : ` (${sanitizeSingleLine(data.thinkingLevel)})`;
  const right = theme.fg("muted", formatModel(data) + thinking);
  const padding = Math.max(
    1,
    width - visibleWidth(title) - visibleWidth(right),
  );
  return truncateToWidth(title + " ".repeat(padding) + right, width, "");
}

class PromptViewer implements Component {
  private readonly content: Text;
  private readonly viewport: ScrollView;
  private readonly safePrompt: string;
  private readonly data: Readonly<ContextDumpData>;
  private readonly environment: ViewerEnvironment;
  private expanded = false;
  private showHelp = false;

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

  private scrollBy(lines: number): void {
    this.viewport.scrollBy(lines);
    this.environment.requestRender();
  }

  private async copy(): Promise<void> {
    try {
      await this.environment.copy();
    } catch (error) {
      this.environment.onError(error);
    }
  }

  handleInput(input: string): void {
    const { environment } = this;
    if (isKey(input, "escape", "q", "shift+q")) {
      environment.close();
    } else if (isKey(input, "f", "shift+f")) {
      this.expanded = !this.expanded;
      environment.requestRender();
    } else if (isKey(input, "?")) {
      this.showHelp = !this.showHelp;
      environment.requestRender();
    } else if (isKey(input, "up", "k")) {
      this.scrollBy(-1);
    } else if (isKey(input, "down", "j")) {
      this.scrollBy(1);
    } else if (isKey(input, "b", "shift+b", "pageUp", "ctrl+pageUp")) {
      this.scrollBy(-Math.max(1, this.viewport.viewportHeight - 1));
    } else if (isKey(input, "space", "pageDown", "ctrl+pageDown")) {
      this.scrollBy(Math.max(1, this.viewport.viewportHeight - 1));
    } else if (isKey(input, "g", "ctrl+home")) {
      this.viewport.scrollToStart();
      environment.requestRender();
    } else if (isKey(input, "shift+g", "ctrl+end")) {
      this.viewport.scrollToEnd();
      environment.requestRender();
    } else if (isKey(input, "c", "shift+c")) {
      void this.copy();
    } else if (isKey(input, "d", "shift+d", "enter")) {
      environment.chat();
      environment.close();
    }
  }

  handleMouse(event: Readonly<TuiMouseEvent>): TuiMouseEventResult | undefined {
    if (
      event.type === "wheel" &&
      event.wheelDelta !== undefined &&
      event.wheelDelta !== 0
    ) {
      this.scrollBy(event.wheelDelta);
      return { handled: true, render: true };
    }
    return undefined;
  }

  invalidate(): void {
    this.content.setText(highlightCode(this.safePrompt, "markdown").join("\n"));
    this.viewport.invalidate();
  }

  private renderChrome(width: number, compact: boolean): string[] {
    const { theme } = this.environment;
    const lines = [renderHeader(this.data, theme, width)];
    if (!compact) {
      lines.push(theme.fg("muted", `  ${formatPromptSummary(this.data)}`));
      if (this.showHelp) {
        lines.push(
          theme.fg("dim", `  ${formatPromptSizeEstimate(this.data)}`),
          theme.fg("dim", "  Up/Down/j/k line · b/Space page · g/G ends"),
          theme.fg(
            "dim",
            `  Esc/q close · f ${this.expanded ? "shorter" : "taller"} · c copy · d/Enter snapshot`,
          ),
        );
      }
      lines.push("");
    }
    return lines;
  }

  private renderFooter(
    layout: Readonly<{
      bodyHeight: number;
      contentHeight: number;
      width: number;
    }>,
    compact: boolean,
  ): string {
    const { bodyHeight, contentHeight, width } = layout;
    const maximum = Math.max(0, contentHeight - bodyHeight);
    const progress =
      maximum === 0
        ? "All"
        : `${Math.round((this.viewport.scrollTop / maximum) * percentScale)}%`;
    const position = `Row ${this.viewport.scrollTop + 1}-${Math.min(this.viewport.scrollTop + bodyHeight, contentHeight)} of ${contentHeight} (${progress})`;
    const actions = compact
      ? "q close · ? help"
      : "q close · c copy · Enter snapshot · ? help";
    const left = truncateToWidth(
      actions,
      Math.max(0, width - visibleWidth(position) - 1),
      "",
    );
    const gap = Math.max(
      1,
      width - visibleWidth(left) - visibleWidth(position),
    );
    return this.environment.theme.fg(
      "dim",
      `${left}${" ".repeat(gap)}${position}`,
    );
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
    const chromeHeight = compact
      ? Math.min(compactChrome, targetHeight - 1)
      : fullChrome + (this.showHelp ? helpChrome : 0);
    const bodyHeight = targetHeight - chromeHeight;
    const body = this.viewport.render(width);
    this.viewport.updateLayout(
      body.length,
      bodyHeight,
      this.environment.requestRender,
    );
    const lines =
      targetHeight <= compactChrome ? [] : this.renderChrome(width, compact);
    lines.push(
      ...body.slice(
        this.viewport.scrollTop,
        this.viewport.scrollTop + bodyHeight,
      ),
    );
    while (lines.length < targetHeight - 1) {
      lines.push("");
    }
    if (targetHeight > 1) {
      lines.push(
        this.renderFooter(
          { bodyHeight, contentHeight: body.length, width },
          compact,
        ),
      );
    }
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
