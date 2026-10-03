import { flavors } from "@catppuccin/palette";
import type {
  ExtensionAPI,
  ExtensionContext,
  ExtensionUIContext,
} from "@earendil-works/pi-coding-agent";

export type FlavorName = keyof typeof flavors;
export type FlavorContext = Readonly<
  Pick<ExtensionContext, "mode"> & {
    ui: Readonly<Pick<ExtensionUIContext, "notify" | "select" | "setTheme">>;
  }
>;

export function isFlavor(name: string): name is FlavorName {
  return Object.hasOwn(flavors, name);
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
      "Mocha (Dark)",
      "Macchiato (Dark)",
      "Frappe (Dark)",
      "Latte (Light)",
    ]);
    if (choice === undefined) {
      return;
    }
    target = choice.split(" ").at(0)?.toLowerCase() ?? "";
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
