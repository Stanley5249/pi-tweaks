# Auto mode design

The `auto` extension in `src/auto/` guards the `bash` and `powershell` tools the
way Claude Code's auto mode guards its tools. A classifier model decides whether
each command matches what the user asked for, so the user is interrupted only
when the classifier keeps refusing or cannot decide.

## Flow

```text
tool_call (bash or powershell)
  |-- guard off -> run
  |-- read-only allowlist match -> run                       allowlist.ts
  `-- classifier (first available entry of `models`)         classify.ts
        |-- allow probability >= threshold -> run, reset the streak
        |-- below threshold -> block, the reason goes to the model
        |     3 blocks in a row or 20 in a session -> ask the user
        `-- error or no classifier -> ask the user
                                      without a UI: block
```

The user's choice in the dialog applies to that one call. `/auto` toggles the
guard for the session, and `/auto on` or `/auto off` sets it.

## Classifier input

The classifier receives one yes or no question with these fields as state:

- `command`, `shell`, and `cwd`
- the last 10 user messages
- the last 20 tool calls, as name and arguments
- `environment`, `allowRules`, and `denyRules` from the config

Assistant text and tool results are left out, because they can carry injected
instructions that argue for the command. Claude Code makes the same choice.

## Config

The guard reads two JSON files when a session starts. Run `/reload` after an
edit. The TypeBox schemas in `config.ts` define the accepted fields.

| File                           | Fields                   |
| ------------------------------ | ------------------------ |
| `~/.pi/agent/auto-mode.json`   | every field below        |
| `<project>/.pi/auto-mode.json` | `environment` and `deny` |

| Field         | Default                                        | Meaning                                      |
| ------------- | ---------------------------------------------- | -------------------------------------------- |
| `enabled`     | `false`                                        | guard state at session start                 |
| `models`      | `["openai/gpt-6-luna", "typesafe/jev-latest"]` | `provider/id` list, the first available wins |
| `threshold`   | `0.5`                                          | minimum allow probability, from 0 to 1       |
| `environment` | `[]`                                           | facts about trusted hosts, repos, and data   |
| `allow`       | `[]`                                           | prose rules for actions to allow             |
| `deny`        | `[]`                                           | prose rules for actions to block             |

A project file adds its entries after the global ones. A project file that sets
any other field is ignored as a whole, so a cloned repository cannot turn the
guard off or add allow rules. A file with invalid JSON or values is ignored, and
pi shows a warning that names the file and the field.

```json
{
  "enabled": true,
  "environment": ["Remote github.com/Stanley5249 is trusted"],
  "deny": ["Force-pushing any branch"]
}
```

GPT-6 Luna needs `OPENAI_API_KEY`, and pi lists it only while `openai` is logged
out of `/login`. The models section of pi's own documentation covers the
classifier providers.

## Decisions

- **No shell parser.** The allowlist accepts a command only when it contains no
  operator, redirection, substitution, or newline, so it never needs to
  understand shell grammar. Everything else goes to the classifier, which reads
  the command as text. A parser such as `just-bash` handles only Bash, adds a
  large dependency tree to startup, and would still leave the decision to the
  classifier.
- **Own config files.** pi's `settings.json` merges project values over global
  ones, which would let a repository loosen the guard.
- **No remembered approvals.** Dialogs are rare, so a per-call answer keeps the
  state small.
- **TypeBox for validation.** pi supplies `typebox` to extensions, so the schema
  costs no install.

## Differences from Claude Code

- Only shell tools are guarded. File edits outside the project are not.
- Read-only `git` commands still read the repository's `.git/config`, which can
  run programs through settings such as `core.fsmonitor`.
- `AGENTS.md` is not sent to the classifier.
