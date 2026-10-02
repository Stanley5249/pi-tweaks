import { expect, test } from "bun:test";
import { join, resolve, sep } from "node:path";
import {
  collectUsage,
  formatCwd,
  formatTokens,
} from "../../src/statusline/stats";
import type { TokenUsage, UsageEntry } from "../../src/statusline/stats";

const kilo = 1000;
const million = kilo * kilo;
const decimalScale = 10;
const decimalLimit = decimalScale * kilo;
const cacheMultiple = 3;
const firstCost = 0.25;
const secondCost = 0.5;
const half = 50;
const latestRate = 75;
const firstUsage = {
  cacheRead: kilo,
  cacheWrite: 0,
  cost: { total: firstCost },
  input: kilo,
  output: kilo,
};
const latestUsage = {
  cacheRead: cacheMultiple * kilo,
  cacheWrite: kilo,
  cost: { total: secondCost },
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
    cacheRead: firstUsage.cacheRead + latestUsage.cacheRead,
    cacheWrite: latestUsage.cacheWrite,
    cost: firstCost + secondCost,
    input: kilo,
    latestCacheHitRate: latestRate,
    output: kilo,
  });
});

test("ignores missing usage and preserves the last valid prompt rate", () => {
  const result = collectUsage([
    assistant(firstUsage),
    { message: { role: "assistant" }, type: "message" },
    {
      message: { role: "assistant", usage: { output: kilo } },
      type: "message",
    },
  ]);
  expect(result.latestCacheHitRate).toBe(half);
  expect(result.output).toBe(firstUsage.output + kilo);
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
  expect(formatTokens(kilo - 1)).toBe("999");
  expect(formatTokens(kilo)).toBe("1.0k");
  expect(formatTokens(decimalLimit)).toBe("10k");
  expect(formatTokens(million)).toBe("1.0M");
});

test("shortens only the home directory and its descendants", () => {
  const home = resolve("user/home");
  expect(formatCwd(home, home)).toBe("~");
  expect(formatCwd(join(home, "project"), home)).toBe(`~${sep}project`);
  expect(formatCwd(`${home}-other`, home)).toBe(`${home}-other`);
  expect(formatCwd(join(home, ".."), home)).toBe(join(home, ".."));
  expect(formatCwd(home)).toBe(home);
});
