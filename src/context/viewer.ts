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
import { sanitizeForTerminal } from "../terminal";

const margin = " ";
// Match the statusline separator so the footer reads like the rest of Pi.
const separator = " · ";
const bodyPadding = 3;
const half = 2;
const tallMargin = 4;
// The title and the footer keys each sit next to a blank separator line.
const headerHeight = 2;
const footerHeight = 2;
// Below this body height the chrome would crowd out the prompt itself.
const bodyMinHeight = 4;
const kilo = 1000;
const million = kilo * kilo;
const decimalScale = 10;
const decimalKiloLimit = decimalScale * kilo;
// The footer already lists close, copy, tall view, and help.
const helpKeys = [
  ["j/k", "line"],
  ["d/u", "half page"],
  ["f/b", "page"],
  ["g/G", "top/bottom"],
] as const;
const helpEntries = helpKeys.map(([key, label]) => `${key} ${label}`);

type ViewerTheme = Readonly<Pick<Theme, "bold" | "fg">>;
export type ViewerEnvironment = Readonly<{
  close: () => void;
  copy: () => Promise<void>;
  getRows: () => number;
  requestRender: () => void;
  theme: ViewerTheme;
}>;

export function formatCount(count: number): string {
  if (count < kilo) {
    return String(count);
  }
  if (count < decimalKiloLimit) {
    return `${(count / kilo).toFixed(1)}k`;
  }
  if (count < million) {
    return `${Math.round(count / kilo)}k`;
  }
  return `${(count / million).toFixed(1)}M`;
}

function isKey(input: string, ...keys: readonly KeyId[]): boolean {
  return keys.some((key) => matchesKey(input, key));
}

function spread(left: string, right: string, width: number): string {
  const fitted = truncateToWidth(
    left,
    Math.max(0, width - visibleWidth(right) - 1),
    "",
  );
  const gap = Math.max(1, width - visibleWidth(fitted) - visibleWidth(right));
  return `${fitted}${" ".repeat(gap)}${right}`;
}

class PromptViewer implements Component {
  private readonly content: Text;
  private readonly viewport: ScrollView;
  private readonly prompt: string;
  private readonly environment: ViewerEnvironment;
  private showHelp = false;
  private tall = false;

  constructor(prompt: string, environment: ViewerEnvironment) {
    this.prompt = prompt;
    this.environment = environment;
    this.content = new Text("", bodyPadding, 0);
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

  handleInput(input: string): void {
    const { environment, viewport } = this;
    const page = Math.max(1, viewport.viewportHeight - 1);
    const halfPage = Math.max(1, Math.floor(viewport.viewportHeight / half));
    if (isKey(input, "escape", "q")) {
      environment.close();
    } else if (isKey(input, "c")) {
      void environment.copy();
    } else if (isKey(input, "t")) {
      this.tall = !this.tall;
      environment.requestRender();
    } else if (isKey(input, "?")) {
      this.showHelp = !this.showHelp;
      environment.requestRender();
    } else if (isKey(input, "up", "k")) {
      this.scrollBy(-1);
    } else if (isKey(input, "down", "j")) {
      this.scrollBy(1);
    } else if (isKey(input, "u")) {
      this.scrollBy(-halfPage);
    } else if (isKey(input, "d")) {
      this.scrollBy(halfPage);
    } else if (isKey(input, "b", "pageUp")) {
      this.scrollBy(-page);
    } else if (isKey(input, "f", "space", "pageDown")) {
      this.scrollBy(page);
    } else if (isKey(input, "g", "home")) {
      viewport.scrollToStart();
      environment.requestRender();
    } else if (isKey(input, "shift+g", "end")) {
      viewport.scrollToEnd();
      environment.requestRender();
    }
  }

  handleMouse(event: Readonly<TuiMouseEvent>): TuiMouseEventResult | undefined {
    const delta = event.type === "wheel" ? (event.wheelDelta ?? 0) : 0;
    if (delta === 0) {
      return undefined;
    }
    this.viewport.scrollBy(delta);
    return { handled: true, render: true };
  }

  invalidate(): void {
    const prompt = sanitizeForTerminal(this.prompt) || "(Empty system prompt)";
    this.content.setText(highlightCode(prompt, "markdown").join("\n"));
    this.viewport.invalidate();
  }

  private renderHeader(): string[] {
    const { theme } = this.environment;
    const title = theme.bold(theme.fg("accent", "System prompt"));
    const size = theme.fg("muted", `${formatCount(this.prompt.length)} chars`);
    return [`${margin}${title}${theme.fg("dim", separator)}${size}`, ""];
  }

  // Use the fewest rows that fit, balanced so a wrap never leaves one entry alone.
  private renderHelp(width: number): string[] {
    const { theme } = this.environment;
    let lines: string[] = [];
    for (let rows = 1; rows <= helpEntries.length; rows += 1) {
      const columns = Math.ceil(helpEntries.length / rows);
      lines = [];
      for (let start = 0; start < helpEntries.length; start += columns) {
        lines.push(
          margin + helpEntries.slice(start, start + columns).join(separator),
        );
      }
      if (lines.every((line) => visibleWidth(line) <= width)) {
        break;
      }
    }
    return lines.map((line) => theme.fg("dim", line));
  }

  private renderFooter(width: number, contentHeight: number): string {
    const { scrollTop, viewportHeight } = this.viewport;
    const last = Math.min(scrollTop + viewportHeight, contentHeight);
    const position = `${scrollTop + 1}-${last} / ${contentHeight}${margin}`;
    const tall = this.tall ? "shorter" : "taller";
    const keys = `${margin}${["q close", "c copy", `t ${tall}`, "? keys"].join(separator)}`;
    return this.environment.theme.fg("dim", spread(keys, position, width));
  }

  render(width: number): string[] {
    const rows = Math.max(1, this.environment.getRows());
    // The viewer opens at half the terminal so recent chat stays visible above it.
    const height = Math.max(
      1,
      this.tall ? rows - tallMargin : Math.floor(rows / half),
    );
    const help = this.showHelp ? this.renderHelp(width) : [];
    const chrome = headerHeight + help.length + footerHeight;
    // Short terminals keep only the body and keys, and tiny ones only the body.
    const full = height - chrome >= bodyMinHeight;
    const hasFooter = full || height > 1;
    const bodyHeight = full ? height - chrome : height - (hasFooter ? 1 : 0);
    const body = this.viewport.render(width);
    this.viewport.updateLayout(
      body.length,
      bodyHeight,
      this.environment.requestRender,
    );
    const { scrollTop } = this.viewport;
    const lines = full ? this.renderHeader() : [];
    lines.push(...body.slice(scrollTop, scrollTop + bodyHeight));
    while (lines.length < (full ? headerHeight : 0) + bodyHeight) {
      lines.push("");
    }
    if (full) {
      lines.push("", ...help);
    }
    if (hasFooter) {
      lines.push(this.renderFooter(width, body.length));
    }
    return lines.map((line) => truncateToWidth(line, width, ""));
  }
}

export function createPromptViewer(
  prompt: string,
  environment: ViewerEnvironment,
): Component {
  return new PromptViewer(prompt, environment);
}
