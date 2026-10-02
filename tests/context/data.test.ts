import { expect, test } from "bun:test";
import {
  collectPromptData,
  formatModel,
  formatPromptSizeEstimate,
  formatPromptSummary,
  parseContextCommand,
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

test("parses context actions and save paths", () => {
  expect(parseContextCommand("")).toEqual({ mode: "view" });
  expect(parseContextCommand(" VIEW ")).toEqual({ mode: "view" });
  expect(parseContextCommand("copy")).toEqual({ mode: "copy" });
  expect(parseContextCommand("chat")).toEqual({ mode: "chat" });
  expect(parseContextCommand("save")).toEqual({
    file: "system-prompt.md",
    mode: "save",
    overwrite: false,
  });
  expect(parseContextCommand("save nested/prompt snapshot.md")).toEqual({
    file: "nested/prompt snapshot.md",
    mode: "save",
    overwrite: false,
  });
  expect(parseContextCommand("unknown")).toBeUndefined();
  expect(parseContextCommand("view unexpected")).toBeUndefined();
});

test("preserves save paths and accepts matching quotes and explicit overwrite", () => {
  for (const path of ["my  prompt.md", '"my  prompt.md"', "'my  prompt.md'"]) {
    expect(parseContextCommand(`save ${path}`)).toEqual({
      file: "my  prompt.md",
      mode: "save",
      overwrite: false,
    });
  }
  expect(parseContextCommand('save --force "my prompt.md"')).toEqual({
    file: "my prompt.md",
    mode: "save",
    overwrite: true,
  });
  expect(parseContextCommand("save --force")).toEqual({
    file: "system-prompt.md",
    mode: "save",
    overwrite: true,
  });
  expect(parseContextCommand('save "unfinished')).toBeUndefined();
  expect(parseContextCommand('save ""')).toBeUndefined();
});

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

test("summarizes the entire prompt with a clearly labeled rough token count", () => {
  expect(
    formatPromptSummary({ promptCharCount: 12, systemPrompt: "base context" }),
  ).toBe("12 chars · ~3 tokens (estimate)");
});

test("labels character-based token counts as an estimate", () => {
  const data = collectPromptData(source());
  expect(formatPromptSizeEstimate(data)).toContain("tokens, chars/4");
  expect(
    formatPromptSizeEstimate({ promptCharCount: 0, systemPrompt: "" }),
  ).toBe("context estimate not recorded");
});

test("sanitizes model metadata before rendering", () => {
  expect(
    formatModel({
      model: "\u001B[31mmodel\u001B[0m",
      promptCharCount: 0,
      provider: "provider\nname",
      systemPrompt: "",
    }),
  ).toBe("provider name/model");
});
