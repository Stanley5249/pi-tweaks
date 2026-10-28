import { expect, test } from "bun:test";
import { collectUsage, formatTokens } from "../../src/statusline/stats";
import type { UsageEntry } from "../../src/statusline/stats";

const assistant: UsageEntry = {
  message: {
    role: "assistant",
    usage: { cacheRead: 3000, cost: { total: 0.1 }, input: 1000 },
  },
  type: "message",
};

test("counts all recorded cost sources once, but hit rate follows the current branch", () => {
  const entries: UsageEntry[] = [
    assistant,
    {
      message: { role: "toolResult", usage: { cost: { total: 0.2 } } },
      type: "message",
    },
    ...["usage", "compaction", "branch_summary"].map((type) => ({
      type,
      usage: { cost: { total: 0.1 } },
    })),
    { type: "custom", usage: { cost: { total: 99 } } },
    {
      message: { role: "user", usage: { cost: { total: 99 } } },
      type: "message",
    },
  ];
  const result = collectUsage(entries, [assistant]);
  expect(result.cost).toBeCloseTo(0.6);
  expect(result.latestCacheHitRate).toBe(75);
  expect(collectUsage(entries, []).latestCacheHitRate).toBeUndefined();
});

test("preserves latest valid prompt usage and includes cache writes in the denominator", () => {
  const branch: UsageEntry[] = [
    assistant,
    {
      message: {
        role: "assistant",
        usage: { cacheRead: 3000, cacheWrite: 1000 },
      },
      type: "message",
    },
    { message: { role: "assistant" }, type: "message" },
  ];
  expect(collectUsage([], branch).latestCacheHitRate).toBe(75);
  expect(collectUsage([], []).cost).toBe(0);
  expect(
    collectUsage(
      [],
      [
        {
          message: { role: "assistant", usage: { input: 1000 } },
          type: "message",
        },
      ],
    ).latestCacheHitRate,
  ).toBe(0);
});

test("formats token boundaries", () => {
  expect(
    [0, 999, 1000, 10_000, 1_000_000].map((count) => formatTokens(count)),
  ).toEqual(["0", "999", "1.0k", "10k", "1.0M"]);
});
