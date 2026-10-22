import { expect, test } from "bun:test";
import { formatContextFiles } from "../../src/guard/classify";
import {
  createGuardRenderer,
  guardLabel,
  guardRenderer,
} from "../../src/guard/render";
import type { GuardMetadata } from "../../src/guard/render";
import type {
  Theme,
  ToolRendererResolver,
} from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";

type RenderContext = Parameters<
  NonNullable<NonNullable<ReturnType<ToolRendererResolver>>["renderResult"]>
>[3];

test("formatContextFiles labels each file and caps the length", () => {
  expect(
    formatContextFiles([
      { content: "a", path: "AGENTS.md" },
      { content: "b", path: "sub/AGENTS.md" },
    ]),
  ).toBe("# AGENTS.md\n\na\n\n# sub/AGENTS.md\n\nb");
  const long = formatContextFiles([
    { content: "x".repeat(20_000), path: "global" },
    { content: "project rules", path: "project" },
  ]);
  expect(long.length).toBe(8000);
  expect(long.endsWith("# project\n\nproject rules")).toBe(true);
});

const metadata: GuardMetadata = {
  decision: "allow",
  durationMs: 420,
  model: "opencode/jev-1.13-free",
  probability: 0.95,
  source: "classifier",
  verdict: "allow",
};

test("Guard labels separate final decisions from classifier verdicts", () => {
  expect(guardLabel(metadata, false)).toBe("Guard: allowed by classifier");
  expect(guardLabel(metadata, true)).toContain("Allow probability: 95.00%");
  expect(guardLabel(metadata, true)).toContain("Classification time: 420 ms");
  expect(
    guardLabel({ ...metadata, source: "user", verdict: "block" }, true),
  ).toContain("Classifier: block");
  expect(
    guardLabel({ ...metadata, source: "user", verdict: "error" }, false),
  ).toBe("Guard: allowed by user after classifier error");
  expect(guardLabel({ decision: "allow", source: "off" }, false)).toBe(
    "Guard: off",
  );
  expect(
    guardLabel({ ...metadata, model: "evil\u001B[31m\ntext" }, true),
  ).toContain("Model: evil text");
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
    state: undefined,
    toolCallId: "test",
  };
}

// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- renderer uses only fg; preserve plain text for assertions
const plainTheme = { fg: (_color: unknown, text: string) => text } as Theme;

test("renderer preserves delegate reuse and displays persisted metadata only on final results", () => {
  const delegate = new Text("shell output", 0, 0);
  const received: unknown[] = [];
  const renderers = {
    // oxlint-disable-next-line max-params -- match Pi's renderer signature
    renderResult: (
      _result: unknown,
      _options: unknown,
      _theme: unknown,
      context: Readonly<{ lastComponent: unknown }>,
    ) => {
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
  expect(compact?.render(80).join("\n")).toContain(
    "Guard: allowed by classifier",
  );
  expect(compact?.render(80).join("\n")).not.toContain("Model:");
  const expanded = renderer?.renderResult?.(
    result,
    { expanded: true, isPartial: false },
    plainTheme,
    { ...context, lastComponent: compact },
  );
  expect(expanded?.render(80).join("\n")).toContain(
    "Model: opencode/jev-1.13-free",
  );
  expect(received).toEqual([undefined, delegate]);
  const partial = renderer?.renderResult?.(
    result,
    { expanded: false, isPartial: true },
    plainTheme,
    context,
  );
  expect(partial?.render(80).join("\n").trimEnd()).toBe("shell output");
  expect(guardRenderer("read", () => renderers)).toBe(renderers);
});

test("live blocked results use their pending decision before persisted details arrive", () => {
  const resolve = createGuardRenderer((id) =>
    id === "test"
      ? { decision: "block", source: "classifier", verdict: "block" }
      : undefined,
  );
  const renderer = resolve("bash", () => ({
    renderResult: () => new Text("blocked", 0, 0),
  }));
  const result = renderer?.renderResult?.(
    { content: [], details: {} },
    { expanded: false, isPartial: false },
    plainTheme,
    renderContext(),
  );
  expect(result?.render(80).join("\n")).toContain(
    "Guard: blocked by classifier",
  );
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
