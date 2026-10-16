import { expect, test } from "bun:test";
import { join, resolve, sep } from "node:path";
import {
  collectUsage,
  formatCwd,
  formatTokens,
} from "../../src/statusline/stats";
import type { TokenUsage, UsageEntry } from "../../src/statusline/stats";

const firstUsage = {
  cacheRead: 1000,
  cacheWrite: 0,
  cost: { total: 0.25 },
  input: 1000,
  output: 1000,
};
const latestUsage = {
  cacheRead: 3000,
  cacheWrite: 1000,
  cost: { total: 0.5 },
  input: 0,
  output: 0,
};

function assistant(usage: TokenUsage): UsageEntry {
  return { message: { role: "assistant", usage }, type: "message" };
}

test("aggregates assistant usage on the supplied branch and uses the latest hit rate", () => {
  const entries: readonly UsageEntry[] = [
    assistant(firstUsage),
    { message: { role: "user", usage: firstUsage }, type: "message" },
    { type: "compaction" },
    assistant(latestUsage),
  ];
  expect(collectUsage(entries)).toEqual({
    cacheRead: 4000,
    cacheWrite: 1000,
    cost: 0.75,
    input: 1000,
    latestCacheHitRate: 75,
    output: 1000,
  });
});

test("ignores missing usage and preserves the last valid prompt rate", () => {
  const result = collectUsage([
    assistant(firstUsage),
    { message: { role: "assistant" }, type: "message" },
    {
      message: { role: "assistant", usage: { output: 1000 } },
      type: "message",
    },
  ]);
  expect(result.latestCacheHitRate).toBe(50);
  expect(result.output).toBe(2000);
});

test("has no cache percentage before any prompt usage", () => {
  expect(collectUsage([])).toEqual({
    cacheRead: 0,
    cacheWrite: 0,
    cost: 0,
    input: 0,
    latestCacheHitRate: undefined,
    output: 0,
  });
});

test("formats token-count boundaries with the original precision", () => {
  expect(formatTokens(0)).toBe("0");
  expect(formatTokens(999)).toBe("999");
  expect(formatTokens(1000)).toBe("1.0k");
  expect(formatTokens(10_000)).toBe("10k");
  expect(formatTokens(1_000_000)).toBe("1.0M");
});

test("shortens only the home directory and its descendants", () => {
  const home = resolve("user/home");
  expect(formatCwd(home, home)).toBe("~");
  expect(formatCwd(join(home, "project"), home)).toBe(`~${sep}project`);
  expect(formatCwd(`${home}-other`, home)).toBe(`${home}-other`);
  expect(formatCwd(join(home, ".."), home)).toBe(join(home, ".."));
  expect(formatCwd(home)).toBe(home);
});
