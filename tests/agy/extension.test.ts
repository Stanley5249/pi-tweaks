import { afterEach, describe, expect, it } from "bun:test";
import agyExtension, { disableAgySearch } from "../../src/agy/index.js";
import type { AgyAPI } from "../../src/agy/index.js";

describe("agy extension", () => {
  const original = process.env["ANTIGRAVITY_NO_SEARCH_TOOL"];

  afterEach(() => {
    if (original === undefined) {
      delete process.env["ANTIGRAVITY_NO_SEARCH_TOOL"];
    } else {
      process.env["ANTIGRAVITY_NO_SEARCH_TOOL"] = original;
    }
  });

  it("sets ANTIGRAVITY_NO_SEARCH_TOOL in process.env", () => {
    delete process.env["ANTIGRAVITY_NO_SEARCH_TOOL"];
    disableAgySearch();
    expect(process.env["ANTIGRAVITY_NO_SEARCH_TOOL"]).toBe("1");
  });

  it("registers no tools or commands", () => {
    const registeredTools: unknown[] = [];
    const registeredCommands: string[] = [];
    const fakePi: AgyAPI = {
      registerCommand: (name: string) => {
        registeredCommands.push(name);
      },
      registerTool: (tool: unknown) => {
        registeredTools.push(tool);
      },
    };

    delete process.env["ANTIGRAVITY_NO_SEARCH_TOOL"];
    agyExtension(fakePi);

    expect(process.env["ANTIGRAVITY_NO_SEARCH_TOOL"]).toBe("1");
    expect(registeredTools).toHaveLength(0);
    expect(registeredCommands).toHaveLength(0);
  });
});
