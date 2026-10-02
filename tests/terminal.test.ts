import { expect, test } from "bun:test";
import { sanitizeForTerminal, sanitizeSingleLine } from "../src/terminal";

test("removes terminal controls without discarding Chinese or line breaks", () => {
  expect(
    sanitizeForTerminal(
      "\u001B[31m中文\u001B[0m\r\n下一行\t內容\u0000\u0007\u007F\u0085",
    ),
  ).toBe("中文\n下一行   內容");
  expect(sanitizeSingleLine("model\r\nname")).toBe("model name");
});
