import type { Verdict } from "./classify";

// Claude Code's auto mode hands control back to the user after this many
// blocks in a row or in one session.
export const maxConsecutiveBlocks = 3;
export const maxTotalBlocks = 20;

export type BlockCounter = Readonly<{
  /** Records a block; true means the user should decide this time. */
  block: () => boolean;
  allow: () => void;
  reset: () => void;
}>;

export function createBlockCounter(): BlockCounter {
  let consecutive = 0;
  let total = 0;
  function reset(): void {
    consecutive = 0;
    total = 0;
  }
  return {
    allow: () => {
      consecutive = 0;
    },
    block: () => {
      consecutive += 1;
      total += 1;
      if (total >= maxTotalBlocks) {
        reset();
        return true;
      }
      if (consecutive >= maxConsecutiveBlocks) {
        consecutive = 0;
        return true;
      }
      return false;
    },
    reset,
  };
}

export type Action =
  | Readonly<{ kind: "allow" }>
  | Readonly<{ kind: "ask" | "block"; reason: string }>;

export function decide(verdict: Verdict, blocks: BlockCounter): Action {
  if (verdict.kind === "allow") {
    blocks.allow();
    return verdict;
  }
  if (verdict.kind === "error") {
    return {
      kind: "ask",
      reason: `Auto mode cannot decide: ${verdict.reason}`,
    };
  }
  return { kind: blocks.block() ? "ask" : "block", reason: verdict.reason };
}
