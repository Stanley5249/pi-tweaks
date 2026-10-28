import { expect, test } from "bun:test";
import { createGuardRenderer, guardLabel } from "../../src/guard/render";
import type { GuardMetadata } from "../../src/guard/render";
import type {
  Theme,
  ToolRendererResolver,
  ToolRenderers,
} from "@earendil-works/pi-coding-agent";
import {
  ToolExecutionComponent,
  initTheme,
} from "@earendil-works/pi-coding-agent";
import { Text, stripTerminalSequences } from "@earendil-works/pi-tui";
import type { TUI } from "@earendil-works/pi-tui";

// Pi's actual row requires a theme. Do not start a theme watcher.
initTheme("dark", false);

type RenderContext = Parameters<
  NonNullable<NonNullable<ReturnType<ToolRendererResolver>>["renderResult"]>
>[3];

const noPending = new Map<string, GuardMetadata>();
const guardRenderer = createGuardRenderer((id) => noPending.get(id));

const metadata: GuardMetadata = {
  decision: "allow",
  durationMs: 420,
  model: "opencode/jev-1.13-free",
  probability: 0.95,
  source: "classifier",
  verdict: "allow",
};

test("Guard summary labels cover every decision source and verdict", () => {
  const cases: [GuardMetadata, string][] = [
    [{ decision: "allow", source: "off" }, "Allowed without checks"],
    [{ decision: "allow", source: "allowlist" }, "Allowed by read-only rule"],
    [
      { decision: "allow", source: "classifier", verdict: "allow" },
      "Allowed by classifier",
    ],
    [
      { decision: "block", source: "classifier", verdict: "block" },
      "Blocked by classifier",
    ],
    [{ decision: "allow", source: "user", verdict: "allow" }, "Allowed by you"],
    [{ decision: "block", source: "user", verdict: "block" }, "Blocked by you"],
    [
      { decision: "allow", source: "user", verdict: "error" },
      "Allowed by you after classifier failure",
    ],
    [
      { decision: "block", source: "user", verdict: "error" },
      "Blocked by you after classifier failure",
    ],
    [
      { decision: "block", source: "classifier", verdict: "error" },
      "Blocked because the classifier failed",
    ],
    [
      { decision: "allow", source: "user", verdict: "unavailable" },
      "Allowed by you because no classifier was available",
    ],
    [
      { decision: "block", source: "user", verdict: "unavailable" },
      "Blocked by you because no classifier was available",
    ],
    [
      { decision: "block", source: "classifier", verdict: "unavailable" },
      "Blocked because no classifier was available",
    ],
    [
      { decision: "block", source: "classifier", verdict: "aborted" },
      "Blocked because the classifier request was cancelled",
    ],
  ];
  for (const [value, expected] of cases) {
    expect(guardLabel(value, false)).toBe(expected);
  }
});

test("expanded labels use colon-free prose and preserve model IDs", () => {
  const label = guardLabel(metadata, true);
  expect(label).toContain("Model opencode/jev-1.13-free");
  expect(label).toContain("Completed in 420 ms");
  expect(label).toContain("Estimated allow probability was 95.00%");
  expect(label).not.toContain("Classifier");
  expect(label.split("\n").every((line) => !line.includes(":"))).toBe(true);
  expect(
    guardLabel({ ...metadata, model: "vendor:model:free" }, true),
  ).toContain("Model vendor:model:free");
  expect(guardLabel({ ...metadata, verdict: "error" }, true)).toContain(
    "Request failed after 420 ms",
  );
  expect(guardLabel({ ...metadata, verdict: "aborted" }, true)).toContain(
    "Request cancelled after 420 ms",
  );
  expect(
    guardLabel({ ...metadata, model: "evil\u001B[31m\ntext" }, true),
  ).toContain("Model evil text");
});

function renderContext(): RenderContext {
  return {
    args: {},
    argsComplete: true,
    cwd: "/repo",
    durationMs: 1,
    executionStarted: true,
    expanded: false,
    invalidate: () => {},
    isError: false,
    isPartial: false,
    lastComponent: undefined,
    outputPad: 0,
    showImages: false,
    state: {},
    toolCallId: "test",
  };
}

// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- renderer uses only fg; preserve plain text for assertions
const plainTheme = { fg: (_color: unknown, text: string) => text } as Theme;

test("renderer preserves delegate reuse and displays persisted metadata during partial and final results", () => {
  const delegate = new Text("shell output", 0, 0);
  const received: unknown[] = [];
  const renderers: ToolRenderers = {
    // oxlint-disable-next-line max-params, typescript/prefer-readonly-parameter-types -- match Pi's renderer signature
    renderResult: (_result, _options, _theme, context) => {
      received.push(context.lastComponent);
      return delegate;
    },
  };
  const renderer = guardRenderer("bash", () => renderers);
  const context = renderContext();
  const result = {
    content: [{ text: "shell output", type: "text" as const }],
    details: { guard: structuredClone(metadata) },
  };
  const compact = renderer?.renderResult?.(
    result,
    { expanded: false, isPartial: false },
    plainTheme,
    context,
  );
  expect(compact?.render(80).join("\n")).toContain("Allowed by classifier");
  expect(compact?.render(80).join("\n")).not.toContain("Model ");
  const expanded = renderer?.renderResult?.(
    result,
    { expanded: true, isPartial: false },
    plainTheme,
    { ...context, lastComponent: compact },
  );
  expect(expanded?.render(80).join("\n")).toContain(
    "Model opencode/jev-1.13-free",
  );
  expect(received).toEqual([undefined, delegate]);
  const partial = renderer?.renderResult?.(
    result,
    { expanded: false, isPartial: true },
    plainTheme,
    context,
  );
  expect(partial?.render(80).map((line) => line.trimEnd())).toEqual([
    "shell output",
    "Allowed by classifier",
  ]);
  expect(guardRenderer("read", () => renderers)).toBe(renderers);
});

test("silent blocked results show their pending decision without a leading gap", () => {
  const resolve = createGuardRenderer((id) =>
    id === "test"
      ? { decision: "block", source: "classifier", verdict: "block" }
      : undefined,
  );
  const renderer = resolve("bash", () => ({
    renderResult: () => new Text("", 0, 0),
  }));
  const result = renderer?.renderResult?.(
    { content: [], details: {} },
    { expanded: false, isPartial: false },
    plainTheme,
    renderContext(),
  );
  expect(result?.render(80).map((line) => line.trimEnd())).toEqual([
    "Blocked by classifier",
  ]);
});

function rowProbe() {
  const pending = new Map<string, GuardMetadata>();
  const redraws = new Map<string, () => void>();
  const requests: string[] = [];
  const resolve = createGuardRenderer(
    (id) => pending.get(id),
    (id, invalidate) => {
      redraws.set(id, invalidate);
    },
  );
  const definition = resolve("bash", () => ({
    renderCall: () => new Text("$ command", 0, 0),
    renderResult: () => new Text("output", 0, 0),
  }));
  function row(id: string): ToolExecutionComponent {
    const ui = {
      requestRender: () => {
        requests.push(id);
      },
    };
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- Pi's row only calls requestRender on this injected TUI
    const tui = ui as unknown as TUI;
    const component = new ToolExecutionComponent(
      "bash",
      id,
      {},
      { outputPad: 0 },
      definition,
      tui,
      "/repo",
    );
    component.markExecutionStarted();
    return component;
  }
  return { pending, redraws, requests, row };
}

function lines(
  component: Readonly<Pick<ToolExecutionComponent, "render">>,
): string[] {
  return component
    .render(80)
    .map((line) => stripTerminalSequences(line).trimEnd());
}

test("real Pi rows show a ready classifier decision before output and move it below output", () => {
  const { pending, redraws, requests, row } = rowProbe();
  const first = row("first");
  const second = row("second");
  expect(lines(first)).toEqual(["", "", "$ command", ""]);
  requests.length = 0;
  pending.set("first", metadata);
  redraws.get("first")?.();
  expect(requests).toEqual(["first"]);
  expect(lines(first)).toEqual([
    "",
    "",
    "$ command",
    "Allowed by classifier",
    "",
  ]);
  expect(lines(second)).toEqual(["", "", "$ command", ""]);
  first.updateResult({ content: [], isError: false }, true);
  expect(lines(first)).toEqual([
    "",
    "",
    "$ command",
    "output",
    "Allowed by classifier",
    "",
  ]);
  first.updateResult({
    content: [],
    details: { guard: metadata },
    isError: false,
  });
  pending.clear();
  first.invalidate();
  expect(lines(first)).toEqual([
    "",
    "",
    "$ command",
    "output",
    "Allowed by classifier",
    "",
  ]);
});

test("renderer leaves historical and malformed metadata results unchanged", () => {
  const renderer = guardRenderer("powershell", () => ({
    renderResult: () => new Text("output", 0, 0),
  }));
  for (const details of [
    undefined,
    { guard: "invalid" },
    { guard: { ...metadata, probability: 2 } },
    { guard: { ...metadata, source: "spoofed" } },
  ]) {
    const result = renderer?.renderResult?.(
      { content: [], details },
      { expanded: true, isPartial: false },
      plainTheme,
      renderContext(),
    );
    expect(result?.render(80).join("\n").trimEnd()).toBe("output");
  }
});
