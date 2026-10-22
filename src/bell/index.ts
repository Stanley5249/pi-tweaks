/**
 * Bell: rings the terminal bell when pi finishes work, so the terminal can
 * alert you. `agent_settled` waits for retries, compaction, and queued
 * messages, and an aborted run stays quiet because you stopped it yourself.
 */
import type {
  AgentSettledEvent,
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { ringBell } from "../terminal";

export type BellAPI = Readonly<Pick<ExtensionAPI, "on">>;

export type BellContext = Readonly<Pick<ExtensionContext, "mode">>;

export default function bellExtension(
  pi: BellAPI,
  bell: (mode: BellContext["mode"]) => void = ringBell,
): void {
  pi.on(
    "agent_settled",
    (event: Readonly<AgentSettledEvent>, ctx: BellContext) => {
      if (!event.aborted) {
        bell(ctx.mode);
      }
    },
  );
}
