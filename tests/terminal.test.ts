import { expect, test } from "bun:test";
import {
  ringBell,
  sanitizeForTerminal,
  sanitizeSingleLine,
} from "../src/terminal";

test("removes terminal controls without discarding Chinese or line breaks", () => {
  expect(
    sanitizeForTerminal(
      "\u001B[31m中文\u001B[0m\r\n下一行\t內容\u0000\u0007\u007F\u0085",
    ),
  ).toBe("中文\n下一行   內容");
  expect(sanitizeSingleLine("model\r\nname")).toBe("model name");
});

test("rings once only in a TUI on a TTY and survives write failures", () => {
  const written: string[] = [];
  const output = (isTTY: boolean) => ({
    isTTY,
    write: (text: string) => written.push(text),
  });
  ringBell("tui", output(true));
  expect(written).toEqual(["\u0007"]);
  for (const mode of ["rpc", "json", "print"]) {
    ringBell(mode, output(true));
  }
  ringBell("tui", output(false));
  expect(written).toEqual(["\u0007"]);
  expect(() => {
    ringBell("tui", {
      isTTY: true,
      write: () => {
        throw new Error("closed");
      },
    });
  }).not.toThrow();
});
