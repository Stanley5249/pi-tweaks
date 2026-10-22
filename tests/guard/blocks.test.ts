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
  expect(decide({ kind: "error", reason: "down" }, blocks).kind).toBe("ask");
});

test("the total limit asks once and then starts over", () => {
  const blocks = createBlockCounter();
  const asks = Array.from({ length: 40 }, () => {
    blocks.allow();
    return blocks.block();
  });
  expect(asks.filter(Boolean)).toHaveLength(2);
  expect(asks[19]).toBe(true);
  expect(asks[39]).toBe(true);
});
