/**
 * Offline dummy model for timing Pi startup without network calls.
 *
 * Usage: pi -e scripts/faux.ts --model faux/dummy --no-session -p hi
 */
import { fauxAssistantMessage, fauxProvider } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function fauxExtension(
  pi: Readonly<Pick<ExtensionAPI, "registerProvider">>,
): void {
  const faux = fauxProvider({ models: [{ id: "dummy" }], provider: "faux" });
  faux.setResponses([fauxAssistantMessage("ok")]);
  pi.registerProvider(faux.provider);
}
