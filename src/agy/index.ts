import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export type AgyAPI = Readonly<
  Pick<ExtensionAPI, "registerCommand" | "registerTool">
>;

export function disableAgySearch(): void {
  process.env["ANTIGRAVITY_NO_SEARCH_TOOL"] = "1";
}

export default function agyExtension(_pi?: AgyAPI): void {
  disableAgySearch();
}
