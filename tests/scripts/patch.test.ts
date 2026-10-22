import { describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { PATCHES, applyPatch } from "../../scripts/patch.ts";
import type { Patch } from "../../scripts/patch.ts";

// Pi 1.4.0 bundles `loadModelsFromSnapshot` like this, minus the parts that
// do not touch the cursor.
const CHUNK =
  "class Selector{loadModelsFromSnapshot(){let models=this.modelRuntime.getAvailableSnapshot().map(model=>({provider:model.provider,id:model.id,model}));this.filteredModels=models;let currentIndex=this.filteredModels.findIndex(item=>modelsAreEqual(this.currentModel,item.model));this.selectedIndex=currentIndex>=0?currentIndex:Math.min(this.selectedIndex,Math.max(0,this.filteredModels.length-1))}}";

type Model = Readonly<{ id: string; provider: string }>;

type Selector = {
  currentModel: Model;
  loadModelsFromSnapshot: () => void;
  modelRuntime: Readonly<{ getAvailableSnapshot: () => readonly Model[] }>;
  selectedIndex: number;
};

function selectorPatch(): Patch {
  const [patch] = PATCHES;
  if (!patch) {
    throw new Error("missing selector patch");
  }
  return patch;
}

function patchedChunk(): string {
  const result = applyPatch(CHUNK, selectorPatch());
  if (result.outcome !== "applied") {
    throw new Error(`patch ${result.outcome}`);
  }
  return result.text;
}

/** Import the patched chunk, so the test runs the edited code itself. */
async function createSelector(
  models: () => readonly Model[],
): Promise<Selector> {
  const code = `const modelsAreEqual=(left,right)=>left.provider===right.provider&&left.id===right.id;${patchedChunk()};export default Selector;`;
  const dir = await mkdtemp(join(tmpdir(), "pi-tweaks-patch-"));
  const file = join(dir, "chunk.js");
  await writeFile(file, code);
  const module: unknown = await import(pathToFileURL(file).href);
  await rm(dir, { recursive: true });
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the fixture above defines this shape
  const { default: SelectorClass } = module as { default: new () => Selector };
  const selector = new SelectorClass();
  selector.currentModel = CURRENT;
  selector.modelRuntime = { getAvailableSnapshot: models };
  selector.selectedIndex = 0;
  return selector;
}

const MODELS: readonly Model[] = ["a", "b", "c"].map((id) => ({
  id,
  provider: "p",
}));
const CURRENT: Model = { id: "b", provider: "p" };

describe("model selector patch", () => {
  test("applies once", () => {
    expect(applyPatch(patchedChunk(), selectorPatch()).outcome).toBe(
      "already applied",
    );
  });

  test("reports code it cannot find", () => {
    expect(applyPatch("class Other{}", selectorPatch()).outcome).toBe(
      "missing",
    );
  });

  test("starts on the current model", async () => {
    const selector = await createSelector(() => MODELS);
    selector.loadModelsFromSnapshot();
    expect(selector.selectedIndex).toBe(1);
  });

  test("keeps the cursor across a refresh", async () => {
    const selector = await createSelector(() => MODELS);
    selector.loadModelsFromSnapshot();
    selector.selectedIndex = 2;
    selector.loadModelsFromSnapshot();
    expect(selector.selectedIndex).toBe(2);
  });

  test("falls back to the current model when the kept one is gone", async () => {
    let models = MODELS;
    const selector = await createSelector(() => models);
    selector.loadModelsFromSnapshot();
    selector.selectedIndex = 2;
    models = MODELS.slice(0, 2);
    selector.loadModelsFromSnapshot();
    expect(selector.selectedIndex).toBe(1);
  });
});
