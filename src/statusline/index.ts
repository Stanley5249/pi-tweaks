import type {
  ExtensionAPI,
  ExtensionContext,
  ExtensionUIContext,
  ReadonlyFooterDataProvider,
} from "@earendil-works/pi-coding-agent";
import { createStatusFooter } from "./render";
import type { FooterTheme, StatusModel } from "./render";
import { collectUsage } from "./stats";
import type { UsageEntry, UsageStats } from "./stats";

export type StatusContext = Readonly<
  Pick<ExtensionContext, "getContextUsage" | "mode" | "thinkingLevel"> & {
    model?: StatusModel | undefined;
    sessionManager: Readonly<{
      getBranch: () => readonly UsageEntry[];
      getCwd: () => string;
      getEntries: () => readonly UsageEntry[];
      getSessionId: () => string;
      getLeafId: () => string | null;
    }>;
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

type CachedUsage = Readonly<{
  session: string;
  leaf: string | null;
  stats: UsageStats;
}>;

function createUsageReader(ctx: StatusContext): () => UsageStats {
  let cached: CachedUsage | undefined = undefined;
  return () => {
    const session = ctx.sessionManager.getSessionId();
    const leaf = ctx.sessionManager.getLeafId();
    // Pi entries are append-only, so an append or tree navigation moves the leaf.
    if (cached?.session !== session || cached.leaf !== leaf) {
      cached = {
        leaf,
        session,
        stats: collectUsage(
          ctx.sessionManager.getEntries(),
          ctx.sessionManager.getBranch(),
        ),
      };
    }
    return cached.stats;
  };
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
    const usage = createUsageReader(ctx);
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
            model: ctx.model,
            stats: usage(),
            statuses: footerData.getExtensionStatuses(),
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
