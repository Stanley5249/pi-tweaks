import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { Type } from "typebox";
import type { Static, TSchema } from "typebox";
import { Value } from "typebox/value";

const Rules = Type.Array(Type.String());
const Models = Type.Array(Type.String({ pattern: "^[^/]+/.+$" }));

// A repository can only add context and deny rules. Allow rules, models,
// thresholds, and the switch stay global so a cloned repository cannot
// loosen the guard.
export const ProjectConfig = Type.Object(
  {
    deny: Type.Optional(Rules),
    environment: Type.Optional(Rules),
  },
  { additionalProperties: false },
);

export const GlobalConfig = Type.Object(
  {
    allow: Type.Optional(Rules),
    deny: Type.Optional(Rules),
    enabled: Type.Optional(Type.Boolean()),
    environment: Type.Optional(Rules),
    models: Type.Optional(Models),
    threshold: Type.Optional(Type.Number({ maximum: 1, minimum: 0 })),
  },
  { additionalProperties: false },
);

export type AutoConfig = Readonly<{
  allow: readonly string[];
  deny: readonly string[];
  enabled: boolean;
  environment: readonly string[];
  /** Classifier models as `provider/id`; the first available one is used. */
  models: readonly string[];
  /** Minimum allow probability; lower blocks the command. */
  threshold: number;
}>;

export type LoadedConfig = Readonly<{
  config: AutoConfig;
  problems: readonly string[];
}>;

export const CONFIG_FILE = "auto-mode.json";

export const defaultConfig: AutoConfig = {
  allow: [],
  deny: [],
  enabled: false,
  environment: [],
  models: ["openai/gpt-6-luna", "typesafe/jev-latest"],
  threshold: 0.5,
};

type Parsed<Data> = Readonly<{ value: Data; problems: readonly string[] }>;

async function readText(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return undefined;
    }
    throw error;
  }
}

/** Reads one config file; a missing file is empty, an invalid one is ignored. */
export async function readConfig<Schema extends TSchema>(
  path: string,
  schema: Schema,
): Promise<Parsed<Static<Schema> | undefined>> {
  try {
    const text = await readText(path);
    const value: unknown = text === undefined ? undefined : JSON.parse(text);
    if (value === undefined || Value.Check(schema, value)) {
      return { problems: [], value };
    }
    const problems = Value.Errors(schema, value).map(
      (error: Readonly<{ instancePath: string; message: string }>) =>
        `${path}: ${error.instancePath || "/"} ${error.message}`,
    );
    return { problems, value: undefined };
  } catch (error) {
    return { problems: [`${path}: ${String(error)}`], value: undefined };
  }
}

export function mergeConfig(
  global: Partial<AutoConfig> = {},
  project: Readonly<Partial<Pick<AutoConfig, "deny" | "environment">>> = {},
): AutoConfig {
  const config = { ...defaultConfig, ...global };
  return {
    ...config,
    deny: [...config.deny, ...(project.deny ?? [])],
    environment: [...config.environment, ...(project.environment ?? [])],
  };
}

export async function loadConfig(
  agentDir: string,
  cwd: string,
): Promise<LoadedConfig> {
  const [global, project] = await Promise.all([
    readConfig(join(agentDir, CONFIG_FILE), GlobalConfig),
    readConfig(join(cwd, ".pi", CONFIG_FILE), ProjectConfig),
  ]);
  return {
    config: mergeConfig(global.value, project.value),
    problems: [...global.problems, ...project.problems],
  };
}
