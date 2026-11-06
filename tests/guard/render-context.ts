import type { ToolRendererResolver } from "@earendil-works/pi-coding-agent";

type RenderContext = Parameters<
  NonNullable<NonNullable<ReturnType<ToolRendererResolver>>["renderResult"]>
>[3];

export function renderContext(
  overrides: Readonly<
    Partial<
      Pick<
        RenderContext,
        "durationMs" | "invalidate" | "isPartial" | "toolCallId"
      >
    >
  > = {},
): RenderContext {
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
    keyHint: () => "",
    keyText: () => "",
    lastComponent: undefined,
    outputPad: 0,
    showImages: false,
    state: {},
    toolCallId: "test",
    ...overrides,
  };
}
