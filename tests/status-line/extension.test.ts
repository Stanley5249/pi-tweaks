import { expect, test } from "bun:test";
import {
  createStatusController,
  selectFlavor,
} from "../../src/status-line/index";
import type { StatusContext } from "../../src/status-line/index";

type Notifications = { message: string; type: string | undefined }[];

function fixture() {
  const state: {
    choice: string | undefined;
    footers: boolean[];
    notifications: Notifications;
    selected: boolean;
    success: boolean;
    themes: string[];
  } = {
    choice: "Latte (Light)",
    footers: [],
    notifications: [],
    selected: false,
    success: true,
    themes: [],
  };
  const ctx: StatusContext = {
    getContextUsage: () => {},
    mode: "tui",
    sessionManager: {
      getBranch: () => [],
      getCwd: () => "project",
      getSessionName: () => {},
    },
    ui: {
      notify: (message, type) => {
        state.notifications.push({ message, type });
      },
      select: async () => {
        state.selected = true;
        return state.choice;
      },
      setFooter: (factory) => {
        state.footers.push(factory !== undefined);
      },
      setTheme: (name: string | Readonly<{ name?: string | undefined }>) => {
        state.themes.push(
          typeof name === "string" ? name : (name.name ?? "unnamed"),
        );
        return { error: "theme unavailable", success: state.success };
      },
    },
  };
  return { ctx, state };
}

test("starts enabled, preserves toggles across sessions, and restores the footer", () => {
  const { ctx, state } = fixture();
  const controller = createStatusController();
  controller.start(ctx);
  controller.toggle(ctx);
  controller.start(ctx);
  controller.toggle(ctx);
  controller.stop(ctx);
  expect(state.footers).toEqual([true, false, false, true, false]);
  expect(state.notifications.at(-1)?.type).toBe("info");
});

test("does not install a footer or mutate enabled state in headless modes", () => {
  const { ctx, state } = fixture();
  const controller = createStatusController();
  const modes = ["print", "rpc", "json"] as const;
  for (const mode of modes) {
    const headless = { ...ctx, mode };
    controller.start(headless);
    controller.toggle(headless);
    controller.stop(headless);
  }
  expect(state.footers).toHaveLength(0);
  controller.start(ctx);
  expect(state.footers).toEqual([true]);
});

test("switches an explicit Catppuccin flavor without a dialog", async () => {
  const { ctx, state } = fixture();
  await selectFlavor(" MACCHIATO ", ctx);
  expect(state.selected).toBe(false);
  expect(state.themes).toEqual(["catppuccin-macchiato"]);
  expect(state.notifications.at(-1)?.type).toBe("info");
});

test("selects a flavor interactively and handles cancellation", async () => {
  const { ctx, state } = fixture();
  await selectFlavor("", ctx);
  expect(state.themes).toEqual(["catppuccin-latte"]);
  state.choice = undefined;
  await selectFlavor("invalid", ctx);
  expect(state.themes).toEqual(["catppuccin-latte"]);
});

test("reports an unavailable theme", async () => {
  const { ctx, state } = fixture();
  state.success = false;
  await selectFlavor("mocha", ctx);
  expect(state.notifications.at(-1)).toEqual({
    message: "Failed to set theme: theme unavailable",
    type: "error",
  });
});

test("does not select or change themes outside TUI mode", async () => {
  const { ctx, state } = fixture();
  await selectFlavor("mocha", { ...ctx, mode: "print" });
  expect(state.selected).toBe(false);
  expect(state.themes).toHaveLength(0);
  expect(state.notifications.at(-1)?.type).toBe("warning");
});
