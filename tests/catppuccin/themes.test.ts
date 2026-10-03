import { expect, test } from "bun:test";
import { fileURLToPath } from "node:url";
import {
  loadThemeFromPath,
  setThemeJsonValidator,
} from "../../node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/theme/theme.js";
import { validateThemeJson } from "../../node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/theme/theme-json.js";
import { visibleWidth } from "@earendil-works/pi-tui";

/* Pi does not export its schema validator; isolate the private API boundary
 * from footer behavior tests until a public validation API is available. */
test("bundled themes pass the Pi schema and render Chinese text", () => {
  setThemeJsonValidator(validateThemeJson);
  const names = ["frappe", "latte", "macchiato", "mocha"] as const;
  for (const name of names) {
    const path = fileURLToPath(
      new URL(
        `../../src/catppuccin/themes/catppuccin-${name}.json`,
        import.meta.url,
      ),
    );
    const theme = loadThemeFromPath(path);
    expect(theme.name).toBe(`catppuccin-${name}`);
    expect(visibleWidth(theme.fg("accent", "中文"))).toBe(visibleWidth("中文"));
  }
});
