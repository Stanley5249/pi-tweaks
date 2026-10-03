import type {
  ExtensionAPI,
  ExtensionContext,
  ExtensionUIContext,
} from "@earendil-works/pi-coding-agent";

export type FlavorContext = Readonly<
  Pick<ExtensionContext, "mode"> & {
    ui: Readonly<Pick<ExtensionUIContext, "notify" | "select" | "setTheme">>;
  }
>;

// Labels double as select options; ids match the bundled theme file names.
const flavors = new Map([
  ["Mocha (Dark)", "mocha"],
  ["Macchiato (Dark)", "macchiato"],
  ["Frappe (Dark)", "frappe"],
  ["Latte (Light)", "latte"],
]);

export function isFlavor(name: string): boolean {
  return [...flavors.values()].includes(name);
}

export async function selectFlavor(
  args: string,
  ctx: FlavorContext,
): Promise<void> {
  if (ctx.mode !== "tui") {
    ctx.ui.notify("Theme selection is available only in TUI mode", "warning");
    return;
  }
  let target = args.trim().toLowerCase();
  if (target === "") {
    const choice = await ctx.ui.select("Select Catppuccin Flavor:", [
      ...flavors.keys(),
    ]);
    if (choice === undefined) {
      return;
    }
    target = flavors.get(choice) ?? "";
  }
  if (!isFlavor(target)) {
    ctx.ui.notify("Invalid Catppuccin flavor", "error");
    return;
  }
  const result = ctx.ui.setTheme(`catppuccin-${target}`);
  if (result.success) {
    ctx.ui.notify(`Switched to Catppuccin ${target}`, "info");
  } else {
    ctx.ui.notify(
      `Failed to set theme: ${result.error ?? "Unknown error"}`,
      "error",
    );
  }
}

export default function catppuccinExtension(
  pi: Readonly<Pick<ExtensionAPI, "registerCommand">>,
): void {
  pi.registerCommand("catppuccin", {
    description: "Switch Catppuccin flavor (mocha, macchiato, frappe, latte)",
    handler: async (args, ctx: FlavorContext) => selectFlavor(args, ctx),
  });
}
