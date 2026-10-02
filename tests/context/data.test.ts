import { expect, test } from "bun:test";
import {
  collectPromptData,
  formatModel,
  formatPromptSizeEstimate,
  sanitizeForTerminal,
  sanitizeSingleLine,
} from "../../src/context/data";
import type { PromptSource } from "../../src/context/data";

function source(): PromptSource {
  return {
    getContextUsage: () => {},
    getSystemPrompt: () => "base: context",
    getSystemPromptOptions: () => ({
      contextFiles: [{ content: "context" }],
    }),
    model: { id: "model", provider: "provider" },
    thinkingLevel: "high",
  };
}

test("captures the exact prompt and separates raw context file bodies", () => {
  expect(collectPromptData(source())).toEqual({
    basePromptCharEstimate: "base: ".length,
    contextFileCharCount: "context".length,
    model: "model",
    promptCharCount: "base: context".length,
    provider: "provider",
    systemPrompt: "base: context",
    thinkingLevel: "high",
    usage: undefined,
  });
});

test("does not subtract context files from a forced system prompt", () => {
  const ctx = source();
  ctx.getSystemPromptOptions = () => ({
    contextFiles: [{ content: "unused context" }],
    forceSystemPrompt: "forced",
  });
  ctx.getSystemPrompt = () => "forced";
  const data = collectPromptData(ctx);
  expect(data.basePromptCharEstimate).toBe("forced".length);
  expect(data.contextFileCharCount).toBe(0);
});

test("clamps the base estimate when context bodies exceed prompt size", () => {
  const ctx = source();
  ctx.getSystemPrompt = () => "";
  expect(collectPromptData(ctx).basePromptCharEstimate).toBe(0);
});

test("preserves missing model and context usage", () => {
  const ctx = source();
  ctx.model = undefined;
  ctx.getSystemPromptOptions = () => ({});
  const data = collectPromptData(ctx);
  expect(formatModel(data)).toBe("unknown");
  expect(data.usage).toBeUndefined();
  expect(data.contextFileCharCount).toBe(0);
});

test("labels character-based token counts as an estimate", () => {
  const data = collectPromptData(source());
  expect(formatPromptSizeEstimate(data)).toContain("tokens, chars/4");
  expect(
    formatPromptSizeEstimate({ promptCharCount: 0, systemPrompt: "" }),
  ).toBe("context estimate not recorded");
});

test("removes terminal controls without discarding Chinese or line breaks", () => {
  expect(
    sanitizeForTerminal(
      "\u001B[31m中文\u001B[0m\r\n下一行\t內容\u0000\u0007\u007F\u0085",
    ),
  ).toBe("中文\n下一行   內容");
  expect(sanitizeSingleLine("model\r\nname")).toBe("model name");
  expect(
    formatModel({
      model: "\u001B[31mmodel\u001B[0m",
      promptCharCount: 0,
      provider: "provider\nname",
      systemPrompt: "",
    }),
  ).toBe("provider name/model");
});
