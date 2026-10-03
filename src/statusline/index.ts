import process from "node:process";
import type {
  ExtensionAPI,
  ExtensionContext,
  ExtensionUIContext,
  ReadonlyFooterDataProvider,
} from "@earendil-works/pi-coding-agent";
import { createStatusFooter } from "./render";
import type { FooterTheme, StatusModel } from "./render";
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
    ui: Readonly<Pick<ExtensionUIContext, "notify" | "setFooter">>;
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
        theme: FooterTheme,
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
            onBranchChange: (handler) => footerData.onBranchChange(handler),
            requestRender: () => tui.requestRender(),
            theme,
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
      this.enabled ? "Statusline enabled" : "Default statusline restored",
      "info",
    );
  }
}

export function createStatusController(): StatusController {
  return new FooterController();
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
    description: "Toggle statusline",
    handler: async (_args, ctx: StatusContext) => controller.toggle(ctx),
  });
}
