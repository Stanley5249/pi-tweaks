/**
 * Bundle installed npm Pi extensions into single JS files to cut startup time.
 *
 * Pi loads each extension entry through a fresh jiti instance, so an entry with
 * hundreds of source files pays for every resolve, read, and evaluation on each
 * start. A bundle replaces those with one file. Each bundle sits next to its
 * entry, so `import.meta.url` in the entry file still resolves sibling assets.
 *
 * The script excludes each bundled entry from its package with a `-path` filter
 * and loads the bundle through the top-level `extensions` setting. A bundle
 * path listed there marks the matching exclusion as owned by this script, so
 * reruns and `--revert` leave the user's own exclusions alone.
 *
 * Bundling is opt in per package because it does not always help. A bundle
 * with top-level await, for example, makes Pi load its own unbundled modules.
 * Time startup with `scripts/faux.ts` before and after to check.
 *
 * Usage: bun run scripts/bundle.ts [npm:<package>...]
 *
 * The listed packages become the full bundled set. Run it with no packages to
 * restore every package to its TypeScript entries.
 */
import { readFile, readdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, join, relative } from "node:path";

export type PackageEntry =
  | string
  | Readonly<{ source: string; extensions?: readonly string[] }>;

export type Settings = Readonly<{
  packages?: readonly PackageEntry[];
  extensions?: readonly string[];
}>;

/** Agent directory and the bundle paths this script listed in settings. */
export type Scope = Readonly<{ owned: readonly string[]; root: string }>;

export type Target = Readonly<{
  bundlePath: string;
  entry: string;
  packageDir: string;
  source: string;
}>;

/** Modules Pi provides through loader aliases, so a bundle must not inline them. */
const EXTERNALS = [
  "@earendil-works/*",
  "@mariozechner/*",
  "typebox",
  "typebox/*",
  "@sinclair/typebox",
  "@sinclair/typebox/*",
  "*.node",
];

const ASSET_PATTERN =
  /import\.meta\.(?:url|dirname|filename)|__dirname|__filename/u;
const SOURCE_PATTERN = /\.[cm]?[jt]s$/u;
const BUNDLE_SUFFIX = ".bundle.js";
const JSON_INDENT = 2;
// Bun.argv starts with the runtime and the script path.
const SCRIPT_ARGS_START = 2;
const NPM_PREFIX = "npm:";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

export function agentDir(): string {
  return process.env["PI_CODING_AGENT_DIR"] ?? join(homedir(), ".pi", "agent");
}

export function sourceOf(entry: PackageEntry): string {
  return typeof entry === "string" ? entry : entry.source;
}

export function normalizeEntry(path: string): string {
  return path.replace(/^\.\//u, "");
}

export function packageDirFor(source: string, root: string): string {
  return join(root, "npm", "node_modules", source.slice(NPM_PREFIX.length));
}

export function bundlePathFor(packageDir: string, entry: string): string {
  const file = join(packageDir, entry);
  const name = basename(file).replace(SOURCE_PATTERN, "");
  return join(dirname(file), `${name}${BUNDLE_SUFFIX}`);
}

/** Returns the `-path` exclusions that the user wrote, not this script. */
export function userExclusions(entry: PackageEntry, scope: Scope): string[] {
  const packageDir = packageDirFor(sourceOf(entry), scope.root);
  const filters = typeof entry === "string" ? [] : (entry.extensions ?? []);
  return filters.filter((filter) => {
    if (!filter.startsWith("-")) {
      throw new Error(
        `${sourceOf(entry)}: only "-path" filters are supported, found "${filter}"`,
      );
    }
    return !scope.owned.includes(bundlePathFor(packageDir, filter.slice(1)));
  });
}

/** Lists the enabled entries of one npm package, given its manifest entries. */
export function packageTargets(
  entry: PackageEntry,
  manifest: readonly string[],
  scope: Scope,
): Target[] {
  const source = sourceOf(entry);
  const packageDir = packageDirFor(source, scope.root);
  const excluded = new Set(
    userExclusions(entry, scope).map((filter) =>
      normalizeEntry(filter.slice(1)),
    ),
  );
  return manifest
    .map((path) => normalizeEntry(path))
    .filter((path) => !excluded.has(path))
    .map((path) => ({
      bundlePath: bundlePathFor(packageDir, path),
      entry: path,
      packageDir,
      source,
    }));
}

function rewritePackage(
  entry: PackageEntry,
  targets: readonly Target[],
  scope: Scope,
): PackageEntry {
  const source = sourceOf(entry);
  if (!source.startsWith(NPM_PREFIX)) {
    return entry;
  }
  const kept = userExclusions(entry, scope);
  const extensions = [
    ...kept,
    ...targets
      .filter((target) => target.source === source)
      .map((target) => `-${target.entry}`),
  ];
  return extensions.length === 0 ? source : { extensions, source };
}

/** Rewrites settings so Pi loads the given targets from their bundles. */
export function applyTargets(
  settings: Settings,
  targets: readonly Target[],
  root: string,
): Settings {
  const owned = settings.extensions ?? [];
  const bundles = targets.map((target) => target.bundlePath);
  const extensions = [
    ...owned.filter(
      (path) => !path.endsWith(BUNDLE_SUFFIX) || bundles.includes(path),
    ),
    ...bundles.filter((path) => !owned.includes(path)),
  ];
  const packages = (settings.packages ?? []).map((entry) =>
    rewritePackage(entry, targets, { owned, root }),
  );
  const { extensions: _previous, ...rest } = settings;
  return extensions.length > 0
    ? { ...rest, extensions, packages }
    : { ...rest, packages };
}

async function readJson(path: string): Promise<Record<string, unknown>> {
  const value: unknown = JSON.parse(await readFile(path, "utf8"));
  if (!isRecord(value)) {
    throw new Error(`${path} is not a JSON object`);
  }
  return value;
}

async function manifestEntries(packageDir: string): Promise<string[]> {
  const manifest = await readJson(join(packageDir, "package.json"));
  return isRecord(manifest["pi"])
    ? stringArray(manifest["pi"]["extensions"])
    : [];
}

/** Warns about files outside the entry folder that locate assets at runtime. */
async function warnAssetPaths(target: Target): Promise<void> {
  const entryDir = dirname(join(target.packageDir, target.entry));
  const files = await readdir(target.packageDir, {
    encoding: "utf8",
    recursive: true,
  });
  const sources = files
    .filter((path) => !path.includes("node_modules"))
    .filter(
      (path) => SOURCE_PATTERN.test(path) && !path.endsWith(BUNDLE_SUFFIX),
    )
    .map((path) => join(target.packageDir, path))
    .filter((file) => dirname(file) !== entryDir);
  const texts = await Promise.all(
    sources.map(async (file) => readFile(file, "utf8")),
  );
  for (const [index, file] of sources.entries()) {
    if (ASSET_PATTERN.test(texts[index] ?? "")) {
      process.stderr.write(
        `warning: ${target.source} ${relative(target.packageDir, file)} locates files at runtime and may break when bundled\n`,
      );
    }
  }
}

async function buildTarget(target: Target): Promise<void> {
  const result = await Bun.build({
    entrypoints: [join(target.packageDir, target.entry)],
    external: EXTERNALS,
    format: "esm",
    target: "node",
  });
  const [output] = result.outputs;
  if (!result.success || !output) {
    throw new AggregateError(
      result.logs,
      `failed to bundle ${target.source} ${target.entry}`,
    );
  }
  await Bun.write(target.bundlePath, output);
  process.stdout.write(`bundled ${target.source} ${target.entry}\n`);
}

async function collectTargets(
  settings: Settings,
  root: string,
): Promise<Target[]> {
  const scope = { owned: settings.extensions ?? [], root };
  const npmEntries = (settings.packages ?? []).filter((entry) =>
    sourceOf(entry).startsWith(NPM_PREFIX),
  );
  const lists = await Promise.all(
    npmEntries.map(async (entry) => {
      const manifest = await manifestEntries(
        packageDirFor(sourceOf(entry), root),
      );
      return packageTargets(entry, manifest, scope);
    }),
  );
  return lists.flat();
}

function toSettings(value: Readonly<Record<string, unknown>>): Settings {
  const packages = Array.isArray(value["packages"])
    ? value["packages"].filter(
        (entry): entry is PackageEntry =>
          typeof entry === "string" ||
          (isRecord(entry) && typeof entry["source"] === "string"),
      )
    : [];
  return { ...value, extensions: stringArray(value["extensions"]), packages };
}

async function main(): Promise<void> {
  const root = agentDir();
  const settingsPath = join(root, "settings.json");
  const raw = await readJson(settingsPath);
  const settings = toSettings(raw);
  const sources = new Set(Bun.argv.slice(SCRIPT_ARGS_START));
  const candidates = await collectTargets(settings, root);
  const targets = candidates.filter((target) => sources.has(target.source));
  await Promise.all(targets.map(async (target) => warnAssetPaths(target)));
  await Promise.all(targets.map(async (target) => buildTarget(target)));
  const { extensions: _previous, ...rest } = raw;
  const next = { ...rest, ...applyTargets(settings, targets, root) };
  await writeFile(
    settingsPath,
    `${JSON.stringify(next, undefined, JSON_INDENT)}\n`,
  );
  process.stdout.write(`updated ${settingsPath}\n`);
}

if (import.meta.main) {
  await main();
}
