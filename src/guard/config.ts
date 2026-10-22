import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { Type } from "typebox";
import type { Static, TSchema } from "typebox";
import { Value } from "typebox/value";

/**
 * Config for the `guard` extension, read from `<agent-dir>/guard.json` and
 * `<project>/.pi/guard.json`. The schema descriptions are the reference.
 */
const Deny = Type.Array(Type.String(), {
  description: "Prose rules for actions the classifier should block.",
});

// A repository can only add deny rules. Everything else, including
// `environment`, which the classifier trusts, stays global so a cloned
// repository cannot loosen the guard.
export const ProjectConfig = Type.Object(
  { deny: Type.Optional(Deny) },
  { additionalProperties: false },
);

const Allow = Type.Array(Type.String(), {
  description: "Prose rules for actions the classifier should allow.",
});
const Enabled = Type.Boolean({
  description:
    "Guard state at startup. Unset means on whenever a classifier is available.",
});
const Environment = Type.Array(Type.String(), {
  description: "Facts about trusted hosts, repositories, and data.",
});
const Model = Type.String({ pattern: "^[^/]+/.+$" });
const Models = Type.Array(Model, {
  description:
    "Classifier models as `provider/id`. The first available one is used.",
});
const Threshold = Type.Number({
  description: "Minimum allow probability. A lower one blocks.",
  maximum: 1,
  minimum: 0,
});

export const GlobalConfig = Type.Object(
  {
    allow: Type.Optional(Allow),
    deny: Type.Optional(Deny),
    enabled: Type.Optional(Enabled),
    environment: Type.Optional(Environment),
    models: Type.Optional(Models),
    threshold: Type.Optional(Threshold),
  },
  { additionalProperties: false },
);

export type GuardConfig = Readonly<{
  allow: readonly string[];
  deny: readonly string[];
  enabled?: boolean | undefined;
  environment: readonly string[];
  models: readonly string[];
  threshold: number;
}>;

export type LoadedConfig = Readonly<{
  config: GuardConfig;
  problems: readonly string[];
}>;

export const CONFIG_FILE = "guard.json";

export const defaultConfig: GuardConfig = {
  allow: [],
  deny: [],
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

/** Reads one config file. A missing file is empty and an invalid one is ignored. */
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
  global: Partial<GuardConfig> = {},
  project: Readonly<Partial<Pick<GuardConfig, "deny">>> = {},
): GuardConfig {
  const config = { ...defaultConfig, ...global };
  return { ...config, deny: [...config.deny, ...(project.deny ?? [])] };
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
