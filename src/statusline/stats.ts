const kilo = 1000;
const million = kilo * kilo;
const decimalScale = 10;
const decimalKiloLimit = decimalScale * kilo;
const percentScale = 100;
const usageTypes = new Set(["usage", "compaction", "branch_summary"]);

export type TokenUsage = Readonly<{
  cacheRead?: number;
  cacheWrite?: number;
  cost?: Readonly<{ total: number }>;
  input?: number;
}>;
export type UsageEntry = Readonly<{
  message?: Readonly<{ role: string; usage?: TokenUsage }>;
  type: string;
  usage?: TokenUsage;
}>;
export type UsageStats = Readonly<{
  cost: number;
  latestCacheHitRate: number | undefined;
}>;

export function collectUsage(
  entries: readonly UsageEntry[],
  branch: readonly UsageEntry[],
): UsageStats {
  let cost = 0;
  for (const entry of entries) {
    cost += usageForCost(entry)?.cost?.total ?? 0;
  }
  const latestCacheHitRate = cacheHitRate(branch);
  return { cost, latestCacheHitRate };
}

function usageForCost(entry: UsageEntry): TokenUsage | undefined {
  if (entry.type === "message") {
    const role = entry.message?.role;
    if (role === "assistant" || role === "toolResult") {
      return entry.message?.usage;
    }
    return undefined;
  }
  return usageTypes.has(entry.type) ? entry.usage : undefined;
}

function cacheHitRate(branch: readonly UsageEntry[]): number | undefined {
  let latest: number | undefined = undefined;
  for (const entry of branch) {
    const usage = assistantUsage(entry);
    if (usage !== undefined) {
      const prompt =
        (usage.input ?? 0) + (usage.cacheRead ?? 0) + (usage.cacheWrite ?? 0);
      if (prompt > 0) {
        latest = ((usage.cacheRead ?? 0) / prompt) * percentScale;
      }
    }
  }
  return latest;
}

function assistantUsage(entry: UsageEntry): TokenUsage | undefined {
  if (entry.type !== "message" || entry.message?.role !== "assistant") {
    return undefined;
  }
  return entry.message.usage;
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
