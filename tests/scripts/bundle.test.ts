import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import {
  applyTargets,
  bundlePathFor,
  packageTargets,
} from "../../scripts/bundle.ts";
import type { Settings } from "../../scripts/bundle.ts";

const ROOT = join("agent");
const PKG = join(ROOT, "npm", "node_modules", "pkg");
const MAIN_BUNDLE = join(PKG, "src", "index.bundle.js");
const SEARCH_BUNDLE = join(PKG, "src", "search.bundle.js");

describe("bundle targets", () => {
  test("places each bundle next to its entry", () => {
    expect(bundlePathFor(PKG, "src/index.ts")).toBe(MAIN_BUNDLE);
  });

  test("skips entries the user excluded", () => {
    const entry = { extensions: ["-src/search.ts"], source: "npm:pkg" };
    const targets = packageTargets(
      entry,
      ["./src/index.ts", "./src/search.ts"],
      { owned: [], root: ROOT },
    );
    expect(targets.map((target) => target.entry)).toEqual(["src/index.ts"]);
  });

  test("bundles entries it excluded on a previous run", () => {
    const entry = { extensions: ["-src/index.ts"], source: "npm:pkg" };
    const targets = packageTargets(entry, ["src/index.ts"], {
      owned: [MAIN_BUNDLE],
      root: ROOT,
    });
    expect(targets.map((target) => target.bundlePath)).toEqual([MAIN_BUNDLE]);
  });

  test("rejects filters other than exact exclusions", () => {
    const entry = { extensions: ["src/*.ts"], source: "npm:pkg" };
    expect(() =>
      packageTargets(entry, ["src/index.ts"], { owned: [], root: ROOT }),
    ).toThrow('only "-path" filters are supported');
  });
});

describe("bundle settings", () => {
  test("swaps entries for bundles and keeps user filters", () => {
    const settings: Settings = {
      extensions: ["local.ts"],
      packages: [
        { extensions: ["-src/search.ts"], source: "npm:pkg" },
        "git:github.com/me/repo",
      ],
    };
    const targets = packageTargets(
      settings.packages?.[0] ?? "",
      ["src/index.ts", "src/search.ts"],
      { owned: [], root: ROOT },
    );
    expect(applyTargets(settings, targets, ROOT)).toEqual({
      extensions: ["local.ts", MAIN_BUNDLE],
      packages: [
        { extensions: ["-src/search.ts", "-src/index.ts"], source: "npm:pkg" },
        "git:github.com/me/repo",
      ],
    });
  });

  test("reverts to the user's own settings", () => {
    const settings: Settings = {
      extensions: [MAIN_BUNDLE, SEARCH_BUNDLE],
      packages: [
        { extensions: ["-src/index.ts", "-src/search.ts"], source: "npm:pkg" },
      ],
    };
    expect(applyTargets(settings, [], ROOT)).toEqual({ packages: ["npm:pkg"] });
  });
});
