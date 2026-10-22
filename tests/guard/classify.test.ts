import { expect, test } from "bun:test";
import { formatContextFiles } from "../../src/guard/classify";

test("formatContextFiles labels each file and caps the length", () => {
  expect(
    formatContextFiles([
      { content: "a", path: "AGENTS.md" },
      { content: "b", path: "sub/AGENTS.md" },
    ]),
  ).toBe("# AGENTS.md\n\na\n\n# sub/AGENTS.md\n\nb");
  const long = formatContextFiles([
    { content: "x".repeat(20_000), path: "global" },
    { content: "project rules", path: "project" },
  ]);
  expect(long.length).toBe(8000);
  expect(long.endsWith("# project\n\nproject rules")).toBe(true);
});
