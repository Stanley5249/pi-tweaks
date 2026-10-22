/**
 * Patch the globally installed Pi until upstream fixes land.
 *
 * Each patch rewrites exact code in Pi's bundled chunks, because the `pi`
 * binary loads `dist/bundle` and not the per-module files under `dist`. Chunk
 * names carry a hash, so the script finds each patch's chunk by its code. The
 * first run saves each changed chunk as `<chunk>.orig`, which `--revert`
 * restores. Reinstalling or upgrading Pi drops the patches, so rerun it after.
 *
 * A patch whose code is missing means upstream changed that code. Check the
 * linked issue, and delete the patch when upstream has fixed it.
 *
 * Usage: bun run scripts/patch.ts [--revert]
 */
import { constants } from "node:fs";
import {
  copyFile,
  readFile,
  readdir,
  rename,
  writeFile,
} from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

export type Patch = Readonly<{
  edits: readonly Readonly<{ after: string; before: string }>[];
  issue: string;
  name: string;
}>;

export const PATCHES: readonly Patch[] = [
  {
    // The selector refreshes catalogs on every open, and the rebuild moved the
    // cursor back to the current model while the user was choosing.
    edits: [
      {
        after:
          "loadModelsFromSnapshot(){let kept=this.filteredModels?.[this.selectedIndex];let models=",
        before: "loadModelsFromSnapshot(){let models=",
      },
      {
        after:
          "let keptIndex=kept?this.filteredModels.findIndex(item=>item.provider===kept.provider&&item.id===kept.id):-1,currentIndex=this.filteredModels.findIndex(item=>modelsAreEqual(this.currentModel,item.model));this.selectedIndex=keptIndex>=0?keptIndex:currentIndex>=0?currentIndex:",
        before:
          "let currentIndex=this.filteredModels.findIndex(item=>modelsAreEqual(this.currentModel,item.model));this.selectedIndex=currentIndex>=0?currentIndex:",
      },
    ],
    issue: "https://github.com/earendil-works/pi/issues/9109",
    name: "keep model selector cursor after refresh",
  },
];

export type Result = Readonly<
  | { outcome: "applied"; text: string }
  | { outcome: "already applied" }
  | { outcome: "missing" }
>;

function occursOnce(text: string, part: string): boolean {
  const index = text.indexOf(part);
  return index !== -1 && !text.includes(part, index + 1);
}

/** Apply a patch to one chunk's text, or report why it cannot. */
export function applyPatch(text: string, patch: Patch): Result {
  if (patch.edits.every((edit) => text.includes(edit.after))) {
    return { outcome: "already applied" };
  }
  if (!patch.edits.every((edit) => occursOnce(text, edit.before))) {
    return { outcome: "missing" };
  }
  return {
    outcome: "applied",
    text: patch.edits.reduce(
      (next, edit) => next.replace(edit.before, edit.after),
      text,
    ),
  };
}

function chunksDir(): string {
  const bunInstall = process.env["BUN_INSTALL"] ?? join(homedir(), ".bun");
  return join(
    bunInstall,
    "install",
    "global",
    "node_modules",
    "@earendil-works",
    "pi-coding-agent",
    "dist",
    "bundle",
    "chunks",
  );
}

async function revert(dir: string): Promise<void> {
  const names = await readdir(dir);
  const chunks = names
    .filter((name) => name.endsWith(".orig"))
    .map((backup) => backup.slice(0, -".orig".length));
  await Promise.all(
    chunks.map(async (chunk) => {
      await rename(join(dir, `${chunk}.orig`), join(dir, chunk));
      process.stdout.write(`restored ${chunk}\n`);
    }),
  );
}

async function writePatched(file: string, text: string): Promise<void> {
  try {
    await copyFile(file, `${file}.orig`, constants.COPYFILE_EXCL);
  } catch (error) {
    // Keep the first backup, because it is the only unpatched copy.
    if (
      !(error instanceof Error && "code" in error && error.code === "EEXIST")
    ) {
      throw error;
    }
  }
  await writeFile(file, text);
}

/** Find the first chunk a patch fits, with its patch result. */
function findChunk(
  texts: readonly (readonly [string, string])[],
  patch: Patch,
): Readonly<{ name: string; result: Result }> | undefined {
  for (const [name, text] of texts) {
    const result = applyPatch(text, patch);
    if (result.outcome !== "missing") {
      return { name, result };
    }
  }
  return undefined;
}

async function apply(dir: string): Promise<boolean> {
  const allNames = await readdir(dir);
  const names = allNames.filter((name) => name.endsWith(".js"));
  const contents = await Promise.all(
    names.map(async (name) => readFile(join(dir, name), "utf8")),
  );
  const texts = new Map(
    names.map((name, index) => [name, contents[index] ?? ""]),
  );
  let ok = true;
  for (const patch of PATCHES) {
    // Patches run one at a time so a later patch sees an earlier one's edit.
    const found = findChunk([...texts], patch);
    if (found?.result.outcome === "applied") {
      // oxlint-disable-next-line eslint/no-await-in-loop -- patches may share a chunk
      await writePatched(join(dir, found.name), found.result.text);
      texts.set(found.name, found.result.text);
    }
    const outcome = found?.result.outcome ?? "missing";
    process.stdout.write(`${outcome}: ${patch.name}\n`);
    if (outcome === "missing") {
      process.stderr.write(`check ${patch.issue}\n`);
      ok = false;
    }
  }
  return ok;
}

async function main(): Promise<void> {
  const dir = chunksDir();
  if (process.argv.includes("--revert")) {
    await revert(dir);
  } else if (!(await apply(dir))) {
    process.exitCode = 1;
  }
}

if (import.meta.main) {
  await main();
}
