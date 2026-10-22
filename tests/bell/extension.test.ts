import { expect, test } from "bun:test";
import bellExtension from "../../src/bell/index";
import type { BellContext } from "../../src/bell/index";

type Handler = (
  event: Readonly<{ aborted: boolean }>,
  ctx: BellContext,
) => void;

test("rings once when pi settles and stays quiet after an abort", () => {
  const handlers = new Map<string, Handler>();
  const rings: string[] = [];
  bellExtension(
    {
      on: (name: string, handler: unknown) => {
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the test dispatches agent_settled payloads only
        handlers.set(name, handler as Handler);
        return () => {};
      },
    },
    (mode) => {
      rings.push(mode);
    },
  );
  const settled = handlers.get("agent_settled");
  settled?.({ aborted: false }, { mode: "tui" });
  expect(rings).toEqual(["tui"]);
  settled?.({ aborted: true }, { mode: "tui" });
  expect(rings).toEqual(["tui"]);
});
