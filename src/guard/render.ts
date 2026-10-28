import type {
  ToolRendererResolver,
  ToolRenderers,
} from "@earendil-works/pi-coding-agent";
import { Container, Text } from "@earendil-works/pi-tui";
import { sanitizeSingleLine } from "../terminal";
import type { Component } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import type { Static } from "typebox";
import { Value } from "typebox/value";

const VerdictSchema = Type.Union([
  Type.Literal("allow"),
  Type.Literal("block"),
  Type.Literal("error"),
  Type.Literal("aborted"),
  Type.Literal("unavailable"),
]);

const Metadata = Type.Object({
  decision: Type.Union([Type.Literal("allow"), Type.Literal("block")]),
  durationMs: Type.Optional(Type.Number({ minimum: 0 })),
  model: Type.Optional(Type.String()),
  probability: Type.Optional(Type.Number({ maximum: 1, minimum: 0 })),
  reason: Type.Optional(Type.String()),
  source: Type.Union([
    Type.Literal("off"),
    Type.Literal("allowlist"),
    Type.Literal("classifier"),
    Type.Literal("user"),
  ]),
  verdict: Type.Optional(VerdictSchema),
});

export type GuardMetadata = Readonly<Static<typeof Metadata>>;

export function recordOf(value: unknown): Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- object shape checked above; properties remain unknown
      (value as Readonly<Record<string, unknown>>)
    : {};
}

const percent = 100;
const decimals = 2;

function summary(metadata: GuardMetadata): string {
  const { decision, source, verdict } = metadata;
  if (source === "off") {
    return "Allowed without checks";
  }
  if (source === "allowlist") {
    return "Allowed by read-only rule";
  }
  const decisionText = decision === "allow" ? "Allowed" : "Blocked";
  if (verdict === "aborted") {
    return "Blocked because the classifier request was cancelled";
  }
  if (verdict === "error") {
    return source === "user"
      ? `${decisionText} by you after classifier failure`
      : "Blocked because the classifier failed";
  }
  if (verdict === "unavailable") {
    return source === "user"
      ? `${decisionText} by you because no classifier was available`
      : "Blocked because no classifier was available";
  }
  return source === "user"
    ? `${decisionText} by you`
    : `${decisionText} by classifier`;
}

function durationLabel(verdict: GuardMetadata["verdict"]): string {
  if (verdict === "error") {
    return "Request failed after";
  }
  if (verdict === "aborted") {
    return "Request cancelled after";
  }
  return "Completed in";
}

export function guardLabel(metadata: GuardMetadata, expanded: boolean): string {
  const { verdict } = metadata;
  const lines = [summary(metadata)];
  if (expanded) {
    if (metadata.model !== undefined) {
      lines.push(`  Model ${metadata.model}`);
    }
    if (metadata.durationMs !== undefined) {
      lines.push(`  ${durationLabel(verdict)} ${metadata.durationMs} ms`);
    }
    if (metadata.probability !== undefined) {
      lines.push(
        `  Estimated allow probability was ${(metadata.probability * percent).toFixed(decimals)}%`,
      );
    }
    if (metadata.reason !== undefined) {
      lines.push(`  ${metadata.reason}`);
    }
  }
  return lines.map((line) => sanitizeSingleLine(line)).join("\n");
}

// Keep the delegate's lastComponent separate from our enclosing container.
class GuardResultComponent extends Container {
  original: Component | undefined;
}

type GuardRendering = Readonly<{
  calls: Readonly<WeakMap<object, GuardResultComponent>>;
  lookup: (toolCallId: string) => GuardMetadata | undefined;
  watch: (toolCallId: string, invalidate: () => void) => void;
}>;

function wrapGuardCall(
  renderCall: NonNullable<ToolRenderers["renderCall"]>,
  state: GuardRendering,
): NonNullable<ToolRenderers["renderCall"]> {
  // Pi does not invoke renderResult until the first tool update or result.
  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Pi owns the renderer callback signature
  return (args, theme, context) => {
    const component =
      context.lastComponent instanceof GuardResultComponent
        ? context.lastComponent
        : new GuardResultComponent();
    component.original = renderCall(args, theme, {
      ...context,
      lastComponent: component.original,
    });
    component.clear();
    component.addChild(component.original);
    state.calls.set(recordOf(context.state), component);
    if (context.executionStarted && context.isPartial) {
      const metadata = state.lookup(context.toolCallId);
      if (Value.Check(Metadata, metadata)) {
        const label = guardLabel(metadata, context.expanded);
        component.addChild(new Text(theme.fg("muted", label), 0, 0));
      } else {
        state.watch(context.toolCallId, context.invalidate);
      }
    }
    return component;
  };
}

function wrapGuardResult(
  renderResult: NonNullable<ToolRenderers["renderResult"]>,
  state: GuardRendering,
): NonNullable<ToolRenderers["renderResult"]> {
  // oxlint-disable-next-line max-params, typescript/prefer-readonly-parameter-types -- Pi owns the renderer callback signature
  return (result, options, theme, context) => {
    const component =
      context.lastComponent instanceof GuardResultComponent
        ? context.lastComponent
        : new GuardResultComponent();
    component.original = renderResult(result, options, theme, {
      ...context,
      lastComponent: component.original,
    });
    component.clear();
    component.addChild(component.original);
    // Move the provisional footer out of the call slot in this same update.
    const call = state.calls.get(recordOf(context.state));
    if (call?.original !== undefined) {
      call.clear();
      call.addChild(call.original);
    }
    const details: unknown = result.details;
    const metadata =
      recordOf(details)["guard"] ?? state.lookup(context.toolCallId);
    if (Value.Check(Metadata, metadata)) {
      const label = guardLabel(metadata, options.expanded);
      component.addChild(new Text(theme.fg("muted", label), 0, 0));
    }
    return component;
  };
}

export function createGuardRenderer(
  lookup: GuardRendering["lookup"],
  watch: GuardRendering["watch"] = () => {},
): ToolRendererResolver {
  // Pi shares state across the call/result slots, but delegates own its fields.
  const state: GuardRendering = { calls: new WeakMap(), lookup, watch };
  return (name, resolve) => {
    const original = resolve();
    if (
      (name !== "bash" && name !== "powershell") ||
      original?.renderResult === undefined
    ) {
      return original;
    }
    return {
      ...original,
      ...(original.renderCall === undefined
        ? {}
        : { renderCall: wrapGuardCall(original.renderCall, state) }),
      renderResult: wrapGuardResult(original.renderResult, state),
    };
  };
}
