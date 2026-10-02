import { flavors } from "@catppuccin/palette";
import type { Theme } from "@earendil-works/pi-coding-agent";

export type FlavorName = keyof typeof flavors;
export type FooterTheme = Readonly<Pick<Theme, "bold" | "fg">>;

export function isFlavor(name: string): name is FlavorName {
  return Object.hasOwn(flavors, name);
}
