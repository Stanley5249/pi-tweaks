import { expect, test } from "bun:test";
import { isFlavor, selectFlavor } from "../../src/catppuccin/index";
import type { FlavorContext } from "../../src/catppuccin/index";

type Notifications = { message: string; type: string | undefined }[];

function fixture() {
  const state: {
    choice: string | undefined;
    notifications: Notifications;
    selected: boolean;
    success: boolean;
    themes: string[];
  } = {
    choice: "Latte (Light)",
    notifications: [],
    selected: false,
    success: true,
    themes: [],
  };
  const ctx: FlavorContext = {
    mode: "tui",
    ui: {
      notify: (message, type) => {
        state.notifications.push({ message, type });
      },
      select: async () => {
        state.selected = true;
        return state.choice;
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

test("validates Catppuccin flavor names", () => {
  expect(isFlavor("mocha")).toBe(true);
  expect(isFlavor("toString")).toBe(false);
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
  await selectFlavor("", ctx);
  expect(state.themes).toEqual(["catppuccin-latte"]);
});

test("rejects explicit invalid flavors without opening a dialog", async () => {
  const { ctx, state } = fixture();
  await selectFlavor("invalid", ctx);
  expect(state.selected).toBe(false);
  expect(state.themes).toHaveLength(0);
  expect(state.notifications.at(-1)?.type).toBe("error");
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
