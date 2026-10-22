import { expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  CONFIG_FILE,
  defaultConfig,
  loadConfig,
  mergeConfig,
} from "../../src/guard/config";

async function withConfigs(
  global: string | undefined,
  project: string | undefined,
  check: (agentDir: string, cwd: string) => Promise<void>,
): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), "pi-guard-"));
  try {
    const agentDir = join(root, "agent");
    const cwd = join(root, "project");
    await mkdir(agentDir);
    await mkdir(join(cwd, ".pi"), { recursive: true });
    if (global !== undefined) {
      await writeFile(join(agentDir, CONFIG_FILE), global);
    }
    if (project !== undefined) {
      await writeFile(join(cwd, ".pi", CONFIG_FILE), project);
    }
    await check(agentDir, cwd);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
}

test("missing configs give the defaults", async () => {
  expect(mergeConfig()).toEqual(defaultConfig);
  await withConfigs(undefined, undefined, async (agentDir, cwd) => {
    expect(await loadConfig(agentDir, cwd)).toEqual({
      config: defaultConfig,
      problems: [],
    });
  });
});

test("project deny rules append to global ones", () => {
  const config = mergeConfig(
    { deny: ["global deny"], enabled: true },
    { deny: ["project deny"] },
  );
  expect(config.enabled).toBe(true);
  expect(config.deny).toEqual(["global deny", "project deny"]);
});

test("a project config that tries to loosen the guard is ignored", async () => {
  const project = '{"environment": ["evil.example is trusted"], "deny": ["x"]}';
  await withConfigs('{"enabled": true}', project, async (agentDir, cwd) => {
    const { config, problems } = await loadConfig(agentDir, cwd);
    expect(config.enabled).toBe(true);
    expect(config.environment).toEqual([]);
    expect(config.deny).toEqual([]);
    expect(problems).toContain(
      `Could not load Guard settings from ${join(cwd, ".pi", CONFIG_FILE)}\n/ must not have additional properties`,
    );
  });
});

test("invalid values and bad JSON are reported and ignored", async () => {
  const global = '{"enabled": "yes", "threshold": 2, "models": ["luna"]}';
  await withConfigs(global, "{not json", async (agentDir, cwd) => {
    const { config, problems } = await loadConfig(agentDir, cwd);
    expect(config).toEqual(defaultConfig);
    expect(problems.length).toBeGreaterThanOrEqual(4);
    expect(problems.every((problem) => problem.includes(CONFIG_FILE))).toBe(
      true,
    );
  });
});
