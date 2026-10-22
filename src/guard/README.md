# Guard

Guard checks the `bash` and `powershell` commands that the model runs. It works
like Claude Code's auto mode. A classifier model reads the command and your
recent requests, and it decides whether the command can run without asking you.

## Setup

Guard needs a classifier model that pi can reach. By default, it tries these in
order:

1. `openai/gpt-6-luna`: set `OPENAI_API_KEY`. pi lists this model only while
   `openai` is logged out of `/login`.
2. `typesafe/jev-latest`: set `TYPESAFE_API_KEY`.

pi's `docs/models.md` lists the other classifier providers. Run `/guard` to see
which model Guard uses. When no classifier is available, Guard stays off and
shows a warning.

## Commands

- `/guard`: show whether Guard is on and which model it uses.
- `/guard on`: turn Guard on.
- `/guard off`: turn Guard off.

The choice lasts until pi exits, including across `/new`, `/resume`, `/fork`,
and `/reload`. The status bar shows `guard` while Guard is on.

## What happens to a command

- A short read-only command runs directly, such as `ls`, `cat`, or
  `Get-Content`. Any operator, quote, or network path sends the command to the
  classifier instead.
- An allowed command runs.
- A blocked command does not run. The model gets the reason, such as
  `[Bypass review]`, and is told to find a safer approach.
- After 3 blocks in a row or 20 in total, pi asks you instead.
- When the classifier fails, pi asks you.
- Without a UI, such as in print mode, a command that needs your answer is
  blocked.

The classifier sees your messages, the model's recent tool calls, and context
files such as `AGENTS.md`. It does not see the model's own text or tool output.

## Config

Guard reads two optional files when a session starts. Run `/reload` after an
edit.

- `~/.pi/agent/guard.json`: every field.
- `<project>/.pi/guard.json`: only `deny`, so a cloned repository cannot loosen
  Guard.

```json
{
  "models": ["openai/gpt-6-luna"],
  "environment": ["github.com/Stanley5249 is my own account"],
  "allow": ["Pushing to my own repositories"],
  "deny": ["Running database migrations"]
}
```

The schema in `config.ts` describes each field. pi shows a warning for an
invalid file and ignores it.

## Limits

- Guard checks only shell commands. File edits and other tools run unchecked.
- The classifier can be wrong. Keep backups and use Git.
