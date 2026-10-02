import { isAbsolute, relative, resolve, sep } from "node:path";

const kilo = 1000;
const million = kilo * kilo;
const decimalScale = 10;
const decimalKiloLimit = decimalScale * kilo;
const percentScale = 100;

export type TokenUsage = Readonly<{
  cacheRead?: number;
  cacheWrite?: number;
  cost?: Readonly<{ total: number }>;
  input?: number;
  output?: number;
}>;
export type UsageEntry = Readonly<{
  message?: Readonly<{ role: string; usage?: TokenUsage }>;
  type: string;
}>;
export type UsageStats = Readonly<{
  cacheRead: number;
  cacheWrite: number;
  cost: number;
  input: number;
  latestCacheHitRate: number | undefined;
  output: number;
}>;

export function collectUsage(entries: readonly UsageEntry[]): UsageStats {
  const totals: { -readonly [Key in keyof UsageStats]: UsageStats[Key] } = {
    cacheRead: 0,
    cacheWrite: 0,
    cost: 0,
    input: 0,
    latestCacheHitRate: undefined,
    output: 0,
  };
  for (const entry of entries) {
    const usage =
      entry.type === "message" && entry.message?.role === "assistant"
        ? entry.message.usage
        : undefined;
    if (usage !== undefined) {
      totals.cacheRead += usage.cacheRead ?? 0;
      totals.cacheWrite += usage.cacheWrite ?? 0;
      totals.cost += usage.cost?.total ?? 0;
      totals.input += usage.input ?? 0;
      totals.output += usage.output ?? 0;
      const promptTokens =
        (usage.input ?? 0) + (usage.cacheRead ?? 0) + (usage.cacheWrite ?? 0);
      if (promptTokens > 0) {
        totals.latestCacheHitRate =
          ((usage.cacheRead ?? 0) / promptTokens) * percentScale;
      }
    }
  }
  return totals;
}

export function formatTokens(count: number): string {
  if (count < kilo) {
    return String(count);
  }
  if (count < decimalKiloLimit) {
    return `${(count / kilo).toFixed(1)}k`;
  }
  if (count < million) {
    return `${Math.round(count / kilo)}k`;
  }
  return `${(count / million).toFixed(1)}M`;
}

export function formatCwd(cwd: string, home?: string): string {
  if (home === undefined || home === "") {
    return cwd;
  }
  const path = relative(resolve(home), resolve(cwd));
  const inside =
    path === "" ||
    (path !== ".." && !path.startsWith(`..${sep}`) && !isAbsolute(path));
  if (!inside) {
    return cwd;
  }
  return path === "" ? "~" : `~${sep}${path}`;
}
