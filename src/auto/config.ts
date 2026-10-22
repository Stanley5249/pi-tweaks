import { readFile } from "node:fs/promises";
import { join } from "node:path";

export type AutoConfig = Readonly<{
  enabled: boolean;
  /** Classifier models as `provider/id`; the first available one is used. */
  models: readonly string[];
  /** Minimum allow probability; lower blocks the command. */
  threshold: number;
  environment: readonly string[];
  allow: readonly string[];
  deny: readonly string[];
}>;

export type LoadedConfig = Readonly<{
  config: AutoConfig;
  problems: readonly string[];
}>;

type RawConfig = Readonly<Record<string, unknown>>;

export const CONFIG_FILE = "auto-mode.json";

export const defaultConfig: AutoConfig = {
  allow: [],
  deny: [],
  enabled: false,
  environment: [],
  models: ["openai/gpt-6-luna", "typesafe/jev-latest"],
  threshold: 0.5,
};

function isRecord(value: unknown): value is RawConfig {
  return typeof value === "object" && Boolean(value) && !Array.isArray(value);
}

function isStringList(value: unknown): value is readonly string[] {
  return (
    Array.isArray(value) && value.every((item) => typeof item === "string")
  );
}

function isThreshold(value: unknown): value is number {
  return typeof value === "number" && value >= 0 && value <= 1;
}

const validators: Readonly<Record<string, (value: unknown) => boolean>> = {
  allow: isStringList,
  deny: isStringList,
  enabled: (value) => typeof value === "boolean",
  environment: isStringList,
  models: isStringList,
  threshold: isThreshold,
};

const globalKeys: readonly string[] = Object.keys(validators);

// A repository can only add context and deny rules. Allow rules, models,
// thresholds, and the switch stay global so a cloned repository cannot
// loosen the guard.
const projectKeys: readonly string[] = ["environment", "deny"];

function problemsOf(
  raw: RawConfig,
  keys: readonly string[],
  label: string,
): string[] {
  return Object.entries(raw).flatMap(
    ([key, value]: readonly [string, unknown]) => {
      if (!keys.includes(key)) {
        return [`${label} config cannot set "${key}"`];
      }
      return validators[key]?.(value) === true
        ? []
        : [`${label} config has an invalid "${key}"`];
    },
  );
}

function listOf(raw: RawConfig, key: string): readonly string[] {
  const value = raw[key];
  return isStringList(value) ? value : [];
}

export function mergeConfig(
  global: RawConfig,
  project: RawConfig,
): LoadedConfig {
  const { enabled, models, threshold } = global;
  const config: AutoConfig = {
    allow: listOf(global, "allow"),
    deny: [...listOf(global, "deny"), ...listOf(project, "deny")],
    enabled: typeof enabled === "boolean" ? enabled : defaultConfig.enabled,
    environment: [
      ...listOf(global, "environment"),
      ...listOf(project, "environment"),
    ],
    models: isStringList(models) ? models : defaultConfig.models,
    threshold: isThreshold(threshold) ? threshold : defaultConfig.threshold,
  };
  const problems = [
    ...problemsOf(global, globalKeys, "Global"),
    ...problemsOf(project, projectKeys, "Project"),
  ];
  return { config, problems };
}

async function readText(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if (isRecord(error) && error["code"] === "ENOENT") {
      return undefined;
    }
    throw error;
  }
}

/** Returns the parsed object, or a problem description. */
export async function readConfigFile(
  path: string,
): Promise<RawConfig | string> {
  try {
    const text = await readText(path);
    if (text === undefined) {
      return {};
    }
    const parsed: unknown = JSON.parse(text);
    return isRecord(parsed) ? parsed : `${path}: expected a JSON object`;
  } catch (error) {
    return `${path}: ${String(error)}`;
  }
}

export async function loadConfig(
  agentDir: string,
  cwd: string,
): Promise<LoadedConfig> {
  const [global, project] = await Promise.all([
    readConfigFile(join(agentDir, CONFIG_FILE)),
    readConfigFile(join(cwd, ".pi", CONFIG_FILE)),
  ]);
  const merged = mergeConfig(
    typeof global === "string" ? {} : global,
    typeof project === "string" ? {} : project,
  );
  const unreadable = [global, project].filter(
    (raw): raw is string => typeof raw === "string",
  );
  return { ...merged, problems: [...unreadable, ...merged.problems] };
}
