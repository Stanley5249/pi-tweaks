import { expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  CONFIG_FILE,
  defaultConfig,
  loadConfig,
  mergeConfig,
} from "../../src/auto/config";

test("empty configs give the defaults", () => {
  expect(mergeConfig({}, {})).toEqual({ config: defaultConfig, problems: [] });
});

test("project config only adds environment and deny", () => {
  const { config, problems } = mergeConfig(
    { deny: ["global deny"], enabled: true, environment: ["global env"] },
    {
      allow: ["anything"],
      deny: ["project deny"],
      enabled: false,
      environment: ["project env"],
      threshold: 0,
    },
  );
  expect(config.enabled).toBe(true);
  expect(config.allow).toEqual([]);
  expect(config.threshold).toBe(defaultConfig.threshold);
  expect(config.deny).toEqual(["global deny", "project deny"]);
  expect(config.environment).toEqual(["global env", "project env"]);
  expect(problems).toEqual([
    'Project config cannot set "allow"',
    'Project config cannot set "enabled"',
    'Project config cannot set "threshold"',
  ]);
});

test("invalid global values fall back and are reported", () => {
  const { config, problems } = mergeConfig(
    { enabled: "yes", models: "luna", threshold: 2, typo: 1 },
    {},
  );
  expect(config).toEqual(defaultConfig);
  expect(problems).toHaveLength(4);
});

test("loadConfig reads both files and reports bad JSON", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-auto-"));
  try {
    const agentDir = join(root, "agent");
    const cwd = join(root, "project");
    await mkdir(agentDir);
    await mkdir(join(cwd, ".pi"), { recursive: true });
    await writeFile(join(agentDir, CONFIG_FILE), '{"enabled": true}');
    await writeFile(join(cwd, ".pi", CONFIG_FILE), "{not json");
    const { config, problems } = await loadConfig(agentDir, cwd);
    expect(config.enabled).toBe(true);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain(CONFIG_FILE);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("missing files are not problems", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-auto-"));
  try {
    expect(await loadConfig(root, root)).toEqual({
      config: defaultConfig,
      problems: [],
    });
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});
