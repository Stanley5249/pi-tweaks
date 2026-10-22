import type { ToolRendererResolver } from "@earendil-works/pi-coding-agent";
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

export function createGuardRenderer(
  lookup: (toolCallId: string) => GuardMetadata | undefined,
): ToolRendererResolver {
  return (name, resolve) => {
    const original = resolve();
    if (
      (name !== "bash" && name !== "powershell") ||
      original?.renderResult === undefined
    ) {
      return original;
    }
    const { renderResult } = original;
    return {
      ...original,
      // oxlint-disable-next-line max-params, typescript/prefer-readonly-parameter-types -- Pi owns the renderer callback signature
      renderResult: (result, options, theme, context) => {
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
        const details: unknown = result.details;
        const metadata =
          recordOf(details)["guard"] ?? lookup(context.toolCallId);
        if (!options.isPartial && Value.Check(Metadata, metadata)) {
          const label = guardLabel(metadata, options.expanded);
          component.addChild(new Text(`\n${theme.fg("muted", label)}`, 0, 0));
        }
        return component;
      },
    };
  };
}
