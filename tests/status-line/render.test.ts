import { expect, test } from "bun:test";
import {
  createPalette,
  isFlavor,
  resolveFlavor,
} from "../../src/status-line/palette";

test("resolves Catppuccin flavors and defaults other themes to mocha", () => {
  expect(resolveFlavor("catppuccin-latte")).toBe("latte");
  expect(resolveFlavor("CATPPUCCIN-FRAPPE")).toBe("frappe");
  expect(resolveFlavor("catppuccin-macchiato")).toBe("macchiato");
  expect(resolveFlavor("dark")).toBe("mocha");
  expect(resolveFlavor()).toBe("mocha");
  expect(isFlavor("mocha")).toBe(true);
  expect(isFlavor("toString")).toBe(false);
});

test("creates flavor-specific terminal colors", () => {
  const mocha = createPalette("mocha").blue("中文");
  const latte = createPalette("latte").blue("中文");
  expect(mocha).toContain("\u001B[38;2;");
  expect(mocha).toContain("中文");
  expect(mocha).not.toBe(latte);
});
