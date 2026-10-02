import type {
  BuildSystemPromptOptions,
  ContextUsage,
} from "@earendil-works/pi-coding-agent";
import { sanitizeSingleLine } from "../terminal";

const charsPerToken = 4;

export type ContextDumpData = {
  basePromptCharEstimate?: number;
  contextFileCharCount?: number;
  model?: string | undefined;
  promptCharCount: number;
  provider?: string | undefined;
  systemPrompt: string;
  thinkingLevel?: string | undefined;
  usage?: Readonly<ContextUsage> | undefined;
};

export type ContextCommand =
  | Readonly<{ mode: "chat" | "copy" | "view" }>
  | Readonly<{ file: string; mode: "save" }>;

export function parseContextCommand(input: string): ContextCommand | undefined {
  const [command = "", ...rest] = input.trim().split(/\s+/u);
  switch (command.toLowerCase()) {
    case "save": {
      return { file: rest.join(" ") || "system-prompt.md", mode: "save" };
    }
    case "":
    case "view": {
      return rest.length === 0 ? { mode: "view" } : undefined;
    }
    case "chat": {
      return rest.length === 0 ? { mode: "chat" } : undefined;
    }
    case "copy": {
      return rest.length === 0 ? { mode: "copy" } : undefined;
    }
    default: {
      return undefined;
    }
  }
}

export type PromptSource = {
  getContextUsage: () => ContextUsage | undefined;
  getSystemPrompt: () => string;
  getSystemPromptOptions: () => Pick<
    BuildSystemPromptOptions,
    "forceSystemPrompt"
  > & {
    contextFiles?: readonly Readonly<{ content: string }>[];
  };
  model?: Readonly<{ id: string; provider: string }> | undefined;
  thinkingLevel?: string | undefined;
};

export function collectPromptData(
  source: Readonly<PromptSource>,
): ContextDumpData {
  const systemPrompt = source.getSystemPrompt();
  const options = source.getSystemPromptOptions();
  const contextFileCharCount =
    options.forceSystemPrompt === undefined
      ? (options.contextFiles?.reduce(
          (total, file) => total + file.content.length,
          0,
        ) ?? 0)
      : 0;
  return {
    basePromptCharEstimate: Math.max(
      0,
      systemPrompt.length - contextFileCharCount,
    ),
    contextFileCharCount,
    model: source.model?.id,
    promptCharCount: systemPrompt.length,
    provider: source.model?.provider,
    systemPrompt,
    thinkingLevel: source.thinkingLevel,
    usage: source.getContextUsage(),
  };
}

export function formatPromptSizeEstimate(
  data: Readonly<ContextDumpData>,
): string {
  const { basePromptCharEstimate: base, contextFileCharCount: context } = data;
  if (base === undefined || context === undefined) {
    return "context estimate not recorded";
  }
  const roughTokens = Math.ceil(base / charsPerToken);
  return `excluding raw context bodies ~${base.toLocaleString()} chars (~${roughTokens.toLocaleString()} tokens, chars/4) | raw context bodies ${context.toLocaleString()} chars`;
}

export function formatModel(data: Readonly<ContextDumpData>): string {
  const provider = sanitizeSingleLine(data.provider ?? "");
  const model = sanitizeSingleLine(data.model ?? "unknown");
  return provider ? `${provider}/${model}` : model;
}
