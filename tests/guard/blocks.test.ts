import { expect, test } from "bun:test";
import {
  createBlockCounter,
  decide,
  maxConsecutiveBlocks,
} from "../../src/guard/blocks";

test("decide escalates to the user after repeated blocks", () => {
  const blocks = createBlockCounter();
  const blocked = { kind: "block", reason: "no" } as const;
  for (let i = 1; i < maxConsecutiveBlocks; i += 1) {
    expect(decide(blocked, blocks).kind).toBe("block");
  }
  expect(decide(blocked, blocks).kind).toBe("ask");
  expect(decide(blocked, blocks).kind).toBe("block");
  expect(decide({ kind: "allow" }, blocks).kind).toBe("allow");
});

test("approval reasons distinguish failed requests from unavailable classifiers", () => {
  const blocks = createBlockCounter();
  expect(
    decide({ kind: "error", reason: "HTTP 429: rate limited" }, blocks),
  ).toEqual({
    kind: "ask",
    reason: "The classifier request failed.\n\nHTTP 429: rate limited",
  });
  expect(
    decide(
      { kind: "unavailable", reason: "No configured classifier is available" },
      blocks,
    ),
  ).toEqual({ kind: "ask", reason: "No configured classifier is available" });
  expect(decide({ kind: "aborted" }, blocks)).toEqual({
    kind: "block",
    reason: "Blocked because the classifier request was cancelled.",
  });
});

test("the total limit asks once and then starts over", () => {
  const blocks = createBlockCounter();
  const asks = Array.from({ length: 40 }, () => {
    blocks.allow();
    return blocks.block();
  });
  expect(asks.flatMap((ask, index) => (ask ? [index] : []))).toEqual([19, 39]);
});
