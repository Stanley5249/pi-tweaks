import { expect, test } from "bun:test";
import { createStatusController } from "../../src/statusline/index";
import type { StatusContext } from "../../src/statusline/index";

type Notifications = { message: string; type: string | undefined }[];

function fixture() {
  const state: {
    footers: boolean[];
    notifications: Notifications;
  } = {
    footers: [],
    notifications: [],
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
      setFooter: (factory) => {
        state.footers.push(factory !== undefined);
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
