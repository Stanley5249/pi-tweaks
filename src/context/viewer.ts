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
// Match the statusline separator so the chrome reads like the rest of Pi.
const separator = " · ";
const bodyPadding = 3;
const half = 2;
const tallMargin = 4;
const rule = "─";
const ruleLead = 2;
const kilo = 1000;
const million = kilo * kilo;
const decimalScale = 10;
const decimalKiloLimit = decimalScale * kilo;
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

class PromptViewer implements Component {
  private readonly content: Text;
  private readonly viewport: ScrollView;
  private readonly prompt: string;
  private readonly environment: ViewerEnvironment;
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

  private renderTitle(contentHeight: number): string {
    const { theme } = this.environment;
    const { scrollTop, viewportHeight } = this.viewport;
    const last = Math.min(scrollTop + viewportHeight, contentHeight);
    const title = theme.bold(theme.fg("accent", "System prompt"));
    const details = [
      `${formatCount(this.prompt.length)} chars`,
      `${scrollTop + 1}-${last} / ${contentHeight}`,
    ].map((detail) => theme.fg("muted", detail));
    return `${margin}${[title, ...details].join(theme.fg("dim", separator))}${margin}`;
  }

  // Color keys apart from labels, like Pi's own hints, so keys scan at a glance.
  private renderHints(): string[] {
    const { theme } = this.environment;
    const keys: readonly (readonly [string, string])[] = [
      ["q", "close"],
      ["c", "copy"],
      ["t", this.tall ? "shorter" : "taller"],
      ["j/k", "line"],
      ["d/u", "half"],
      ["f/b", "page"],
      ["g/G", "ends"],
    ];
    return keys.map(
      ([key, label]) =>
        theme.fg("accent", key) + theme.fg("muted", ` ${label}`),
    );
  }

  // The ruler marks where the chat above ends and carries the keys on its right.
  // Viewer actions lead, so narrow terminals drop the scroll keys first.
  private renderHeader(width: number, contentHeight: number): string {
    const { theme } = this.environment;
    const ruler = (length: number) =>
      theme.fg("borderMuted", rule.repeat(Math.max(0, length)));
    const title = this.renderTitle(contentHeight);
    const hints = this.renderHints();
    // Keep at least one rule cell between the title and the keys.
    const room = width - ruleLead * half - visibleWidth(title) - 1;
    for (let count = hints.length; count > 0; count -= 1) {
      const keys = `${margin}${hints.slice(0, count).join(theme.fg("dim", separator))}${margin}`;
      if (visibleWidth(keys) <= room) {
        const fill = room - visibleWidth(keys) + 1;
        return ruler(ruleLead) + title + ruler(fill) + keys + ruler(ruleLead);
      }
    }
    return (
      ruler(ruleLead) + title + ruler(width - ruleLead - visibleWidth(title))
    );
  }

  render(width: number): string[] {
    const rows = Math.max(1, this.environment.getRows());
    // The viewer opens at half the terminal so recent chat stays visible above it.
    const height = Math.max(
      1,
      this.tall ? rows - tallMargin : Math.floor(rows / half),
    );
    // A one-row viewer spends its only row on the prompt itself.
    const hasHeader = height > 1;
    const bodyHeight = hasHeader ? height - 1 : height;
    const body = this.viewport.render(width);
    this.viewport.updateLayout(
      body.length,
      bodyHeight,
      this.environment.requestRender,
    );
    const { scrollTop } = this.viewport;
    const lines = body.slice(scrollTop, scrollTop + bodyHeight);
    while (lines.length < bodyHeight) {
      lines.push("");
    }
    if (hasHeader) {
      lines.unshift(this.renderHeader(width, body.length));
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
