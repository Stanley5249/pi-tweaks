import process from "node:process";
import type {
  ExtensionAPI,
  ExtensionContext,
  ExtensionUIContext,
  ReadonlyFooterDataProvider,
} from "@earendil-works/pi-coding-agent";
import { isFlavor } from "./palette";
import { createStatusFooter } from "./render";
import type { StatusModel } from "./render";
import { collectUsage } from "./stats";
import type { UsageEntry } from "./stats";

export type StatusContext = Readonly<
  Pick<ExtensionContext, "getContextUsage" | "mode"> & {
    model?: StatusModel | undefined;
    sessionManager: Readonly<{
      getBranch: () => readonly UsageEntry[];
      getCwd: () => string;
      getSessionName: () => string | undefined;
    }>;
    thinkingLevel?: string | undefined;
    ui: Readonly<
      Pick<ExtensionUIContext, "notify" | "select" | "setFooter" | "setTheme">
    >;
  }
>;
export type StatusController = Readonly<{
  start: (ctx: StatusContext) => void;
  stop: (ctx: StatusContext) => void;
  toggle: (ctx: StatusContext) => void;
}>;
type FooterData = Readonly<
  Pick<
    ReadonlyFooterDataProvider,
    "getExtensionStatuses" | "getGitBranch" | "onBranchChange"
  >
>;

function homeDirectory(): string | undefined {
  const home = process.env["USERPROFILE"];
  if (home !== undefined && home !== "") {
    return home;
  }
  return process.env["HOME"];
}

class FooterController implements StatusController {
  private enabled = true;

  start(ctx: StatusContext): void {
    if (ctx.mode !== "tui") {
      return;
    }
    if (!this.enabled) {
      ctx.ui.setFooter(undefined);
      return;
    }
    ctx.ui.setFooter(
      (
        tui: Readonly<{ requestRender: () => void }>,
        theme: Readonly<{ name?: string | undefined }>,
        footerData: FooterData,
      ) =>
        createStatusFooter(
          () => ({
            branch: footerData.getGitBranch(),
            contextUsage: ctx.getContextUsage(),
            cwd: ctx.sessionManager.getCwd(),
            home: homeDirectory(),
            model: ctx.model,
            sessionName: ctx.sessionManager.getSessionName(),
            stats: collectUsage(ctx.sessionManager.getBranch()),
            statuses: [...footerData.getExtensionStatuses().values()],
            thinkingLevel: ctx.thinkingLevel,
          }),
          {
            getThemeName: () => theme.name,
            onBranchChange: (handler) => footerData.onBranchChange(handler),
            requestRender: () => tui.requestRender(),
          },
        ),
    );
  }

  stop(ctx: StatusContext): void {
    if (ctx.mode === "tui") {
      ctx.ui.setFooter(undefined);
    }
  }

  toggle(ctx: StatusContext): void {
    if (ctx.mode !== "tui") {
      ctx.ui.notify("Status line is available only in TUI mode", "warning");
      return;
    }
    this.enabled = !this.enabled;
    this.start(ctx);
    ctx.ui.notify(
      this.enabled
        ? "Catppuccin status bar enabled"
        : "Default status bar restored",
      "info",
    );
  }
}

export function createStatusController(): StatusController {
  return new FooterController();
}

export async function selectFlavor(
  args: string,
  ctx: StatusContext,
): Promise<void> {
  if (ctx.mode !== "tui") {
    ctx.ui.notify("Theme selection is available only in TUI mode", "warning");
    return;
  }
  let target = args.trim().toLowerCase();
  if (!isFlavor(target)) {
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

export default function statusLineExtension(
  pi: Readonly<Pick<ExtensionAPI, "on" | "registerCommand">>,
): void {
  const controller = createStatusController();
  pi.on("session_start", (_event: unknown, ctx: StatusContext) =>
    controller.start(ctx),
  );
  pi.on("session_shutdown", (_event: unknown, ctx: StatusContext) =>
    controller.stop(ctx),
  );
  pi.registerCommand("statusline", {
    description: "Toggle Catppuccin status bar",
    handler: async (_args, ctx: StatusContext) => controller.toggle(ctx),
  });
  pi.registerCommand("catppuccin", {
    description: "Switch Catppuccin flavor (mocha, macchiato, frappe, latte)",
    handler: async (args, ctx: StatusContext) => selectFlavor(args, ctx),
  });
}
