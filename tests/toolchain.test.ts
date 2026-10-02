import { expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import config from "../.oxlintrc.json";

const root = resolve(import.meta.dir, "..");
const successfulExit = 0;

async function lint(
  source: string,
): Promise<{ exitCode: number; output: string }> {
  const directory = await mkdtemp(join(import.meta.dir, ".toolchain-"));
  try {
    await writeFile(join(directory, "probe.ts"), source);
    await writeFile(
      join(directory, "tsconfig.json"),
      JSON.stringify({
        extends: "../../tsconfig.json",
        include: ["probe.ts"],
      }),
    );
    const child = Bun.spawn(
      [
        process.execPath,
        "--bun",
        join(root, "node_modules/oxlint/bin/oxlint"),
        "--config",
        join(root, ".oxlintrc.json"),
        "probe.ts",
      ],
      { cwd: directory, stderr: "pipe", stdout: "pipe" },
    );
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    return { exitCode, output: stdout + stderr };
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
}

test("enforces pedantic checks without experimental categories", () => {
  expect(config.categories.pedantic).toBe("error");
  expect(config.categories.restriction).toBe("off");
  expect(config.categories.nursery).toBe("off");
  expect(config.options).toMatchObject({
    denyWarnings: true,
    reportUnusedDisableDirectives: "error",
    typeAware: true,
    typeCheck: true,
  });
});

test("accepts valid TypeScript", async () => {
  const result = await lint("export const answer = 42;\n");
  expect(result.output).toBe("");
  expect(result.exitCode).toBe(successfulExit);
});

test("rejects unhandled promises using type information", async () => {
  const result = await lint(
    "export async function pending(): Promise<void> {}\npending();\n",
  );
  expect(result.exitCode).not.toBe(successfulExit);
  expect(result.output).toContain("no-floating-promises");
});

test("rejects TypeScript compiler errors", async () => {
  const result = await lint('export const answer: number = "wrong";\n');
  expect(result.exitCode).not.toBe(successfulExit);
  expect(result.output).toContain("TS2322");
});

test("rejects unused lint suppressions", async () => {
  const result = await lint(
    "// oxlint-disable-next-line no-console\nexport const answer = 42;\n",
  );
  expect(result.exitCode).not.toBe(successfulExit);
  expect(result.output).toContain("Unused");
});
