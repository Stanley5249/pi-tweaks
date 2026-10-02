import { flavors } from "@catppuccin/palette";

export type FlavorName = keyof typeof flavors;
export type PaletteColor =
  | "blue"
  | "green"
  | "lavender"
  | "mauve"
  | "overlay1"
  | "peach"
  | "red"
  | "sky"
  | "subtext0"
  | "subtext1"
  | "surface2"
  | "teal"
  | "yellow";
export type Palette = Readonly<Record<PaletteColor, (text: string) => string>>;

export function isFlavor(name: string): name is FlavorName {
  return Object.hasOwn(flavors, name);
}

export function resolveFlavor(themeName = ""): FlavorName {
  const name = themeName.toLowerCase();
  if (name.includes("latte")) {
    return "latte";
  }
  if (name.includes("frappe")) {
    return "frappe";
  }
  if (name.includes("macchiato")) {
    return "macchiato";
  }
  return "mocha";
}

function foreground(
  rgb: Readonly<{ b: number; g: number; r: number }>,
): (text: string) => string {
  return (text) => `\u001B[38;2;${rgb.r};${rgb.g};${rgb.b}m${text}\u001B[39m`;
}

export function createPalette(name: FlavorName): Palette {
  const { colors } = flavors[name];
  return {
    blue: foreground(colors.blue.rgb),
    green: foreground(colors.green.rgb),
    lavender: foreground(colors.lavender.rgb),
    mauve: foreground(colors.mauve.rgb),
    overlay1: foreground(colors.overlay1.rgb),
    peach: foreground(colors.peach.rgb),
    red: foreground(colors.red.rgb),
    sky: foreground(colors.sky.rgb),
    subtext0: foreground(colors.subtext0.rgb),
    subtext1: foreground(colors.subtext1.rgb),
    surface2: foreground(colors.surface2.rgb),
    teal: foreground(colors.teal.rgb),
    yellow: foreground(colors.yellow.rgb),
  };
}

export function bold(text: string): string {
  return `\u001B[1m${text}\u001B[22m`;
}
