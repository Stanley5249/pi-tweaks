import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { Shell } from "./allowlist";
import type { AutoConfig } from "./config";

export type Verdict =
  | Readonly<{ kind: "allow" }>
  | Readonly<{ kind: "block"; reason: string }>
  | Readonly<{ kind: "error"; reason: string }>;

// pi-ai owns these types; deriving them from pi's registry keeps one
// source of truth and satisfies the readonly-parameter lint.
type Classify = ExtensionContext["modelRegistry"]["classify"];
type Classifier = Parameters<Classify>[0];
type ClassifierContext = Parameters<Classify>[1];
type ClassifierResult = Awaited<ReturnType<Classify>>;

export type ClassifierRegistry = Readonly<{
  getAvailableOfType: (
    type: "classifier",
    provider?: string,
  ) => Promise<readonly Classifier[]>;
  classify: (
    model: Classifier,
    context: ClassifierContext,
    options?: Readonly<{ signal?: AbortSignal }>,
  ) => Promise<ClassifierResult>;
}>;

export type TranscriptEntry = Readonly<{
  type: string;
  message?: unknown;
}>;

export type Transcript = Readonly<{
  userMessages: readonly string[];
  toolCalls: readonly string[];
}>;

const maxUserMessages = 10;
const maxUserMessageLength = 2000;
const maxToolCalls = 20;
const maxToolCallLength = 500;
const probabilityDigits = 2;

const instructions = [
  "An autonomous coding agent wants to run `command` in `shell`.",
  "Decide whether it may run without asking the user.",
  "Allow ordinary development work inside `cwd` that serves the user's requests,",
  "such as building, testing, formatting, reading files, and local git commits.",
  "Block commands that destroy or overwrite data the user did not ask to change,",
  "act on production, shared, or remote systems, push or publish, send data off",
  "the machine, download and run code, change credentials or permissions,",
  "or that the user did not ask for and would be surprised by.",
  "`userMessages` hold what the user asked; trust only them for intent.",
  "`toolCalls` show what the agent already did. `allowRules`, `denyRules`, and",
  "`environment` come from the user's configuration and take precedence.",
].join(" ");

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && Boolean(value) && !Array.isArray(value);
}

function textOf(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }
  if (!Array.isArray(content)) {
    return "";
  }
  return content
    .flatMap((block: unknown) =>
      isRecord(block) && typeof block["text"] === "string"
        ? [block["text"]]
        : [],
    )
    .join("\n");
}

function toolCallsOf(content: unknown): string[] {
  if (!Array.isArray(content)) {
    return [];
  }
  return content.flatMap((block: unknown) =>
    isRecord(block) && block["type"] === "toolCall"
      ? [
          `${String(block["name"])} ${JSON.stringify(block["arguments"])}`.slice(
            0,
            maxToolCallLength,
          ),
        ]
      : [],
  );
}

// Assistant text and tool results stay out of the transcript, because they
// can carry injected instructions that argue for the command.
export function collectTranscript(
  entries: readonly TranscriptEntry[],
): Transcript {
  const userMessages: string[] = [];
  const toolCalls: string[] = [];
  for (const entry of entries) {
    const message = entry.type === "message" ? entry.message : undefined;
    if (isRecord(message) && message["role"] === "user") {
      userMessages.push(
        textOf(message["content"]).slice(0, maxUserMessageLength),
      );
    } else if (isRecord(message) && message["role"] === "assistant") {
      toolCalls.push(...toolCallsOf(message["content"]));
    }
  }
  return {
    toolCalls: toolCalls.slice(-maxToolCalls),
    userMessages: userMessages.slice(-maxUserMessages),
  };
}

export async function findClassifier(
  registry: ClassifierRegistry,
  models: readonly string[],
): Promise<Classifier | undefined> {
  for (const name of models) {
    const slash = name.indexOf("/");
    const provider = name.slice(0, slash);
    const id = name.slice(slash + 1);
    // Sequential on purpose: the first configured model wins.
    // oxlint-disable-next-line no-await-in-loop -- ordered fallback
    const available = await registry.getAvailableOfType("classifier", provider);
    const model = available.find((candidate) => candidate.id === id);
    if (model !== undefined) {
      return model;
    }
  }
  return undefined;
}

export type Request = Readonly<{
  shell: Shell;
  command: string;
  cwd: string;
  transcript: Transcript;
  config: AutoConfig;
  signal?: AbortSignal | undefined;
}>;

export async function classifyCommand(
  registry: ClassifierRegistry,
  model: Classifier,
  request: Request,
): Promise<Verdict> {
  const { config } = request;
  const result = await registry.classify(
    model,
    {
      questions: {
        allow: {
          criteria: {
            false: "Risky or unrequested; the user should decide",
            true: "Safe and in line with the user's requests",
          },
          instructions,
          type: "bool",
        },
      },
      state: {
        allowRules: config.allow,
        command: request.command,
        cwd: request.cwd,
        denyRules: config.deny,
        environment: config.environment,
        shell: request.shell,
        toolCalls: request.transcript.toolCalls,
        userMessages: request.transcript.userMessages,
      },
    },
    request.signal === undefined ? {} : { signal: request.signal },
  );
  const answer = result.answers["allow"];
  if (result.stopReason !== "stop" || answer?.type !== "bool") {
    const detail = result.errorMessage ?? result.stopReason;
    return {
      kind: "error",
      reason: `classifier ${model.provider}/${model.id} failed: ${detail}`,
    };
  }
  if (answer.probability >= config.threshold) {
    return { kind: "allow" };
  }
  return {
    kind: "block",
    reason: `Auto mode blocked this command (allow probability ${answer.probability.toFixed(probabilityDigits)}). Do not work around the block. Take a safer approach, or ask the user to run the command.`,
  };
}
