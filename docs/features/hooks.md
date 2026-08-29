---
title: "Lifecycle Hooks"
description: "Run your own shell commands at fixed points in the agent loop — deterministic, token-free, and able to veto a tool call"
sidebar_order: 5
---

# Lifecycle Hooks

A hook is a shell command Nanocoder runs at a defined point in the agent loop: before or after a tool executes, when a session starts or ends, when you submit a prompt, or just before context compaction.

Hooks are deterministic and free. No model is involved, no tokens are spent, and they fire every time — rather than when the model remembers to.

This is what makes rules like these enforceable:

- Run the formatter on every file the agent writes.
- Never touch `.env`. Never push to `main`.
- Put `git log -5` in front of the model at session start.
- Append every tool call to an audit log.
- Post to Slack when a long run finishes.

## Hooks vs. skill subscriptions

Nanocoder already has [skill subscriptions](skills.md#event-subscriptions), and they solve a different problem:

| | Skill subscriptions | Hooks |
|---|---|---|
| Triggered by | The outside world (file changed, cron fired) | Nanocoder itself |
| What runs | An AI subagent | A shell command |
| Cost | LLM tokens on every fire | Free, instant |
| Deterministic | No | Yes |
| Requires the daemon | Yes | No |
| Can veto an action | No | Yes (`pre-tool-use`) |

Reach for a subscription when you want an AI to look at something that changed. Reach for a hook when you want something to happen, exactly, every time.

## Quick Start

Hooks live under `nanocoder.hooks` in `agents.config.json`, keyed by lifecycle point:

```json
{
  "nanocoder": {
    "hooks": {
      "post-tool-use": [
        {
          "matchTools": ["write_file", "string_replace"],
          "command": "biome check --write \"$NANOCODER_FILE\""
        }
      ],
      "pre-tool-use": [
        {
          "name": "no-env",
          "matchTools": ["write_file", "string_replace"],
          "command": ".nanocoder/hooks/guard.sh"
        }
      ],
      "session-start": [{"command": "git log --oneline -5"}]
    }
  }
}
```

Every hook is one object with:

| Field | Required | Meaning |
|-------|----------|---------|
| `command` | yes | Shell command to run. Runs through `sh -c` (`cmd.exe` on Windows). |
| `matchTools` | no | Tool names this hook applies to. Omitted means every tool. Ignored by non-tool events. |
| `timeout` | no | Milliseconds before the hook is killed. Defaults to 30000. |
| `name` | no | Label shown in transcripts, error messages, and `/doctor`. Defaults to the command. |

Entries without a usable `command` string are dropped with an error in the log rather than failing the session, and an unknown event name is ignored the same way. `/doctor` prints everything that actually loaded, so you can see what is wired up.

## Lifecycle points

| Event | Fires | Can veto |
|-------|-------|----------|
| `session-start` | Once, as the session initializes | no |
| `session-end` | During graceful shutdown, before the UI tears down | no |
| `user-prompt-submit` | Before a chat prompt is sent to the model | **yes** |
| `pre-tool-use` | Before a tool executes | **yes** |
| `post-tool-use` | After a tool returns | no |
| `pre-compact` | Before context compaction, automatic or `/compact` | no |

`user-prompt-submit` fires for chat prompts only, not slash commands — a slash command is a local UI action, and injecting context into one would break its argument parsing.

Surfaces:

- `pre-tool-use` and `post-tool-use` fire everywhere tools run: the interactive TUI (including streamed `execute_bash`), `nanocoder run`, the `--plain` shell, ACP, and subagents.
- `session-start`, `session-end`, and `user-prompt-submit` fire in the interactive TUI and in `run` / `--plain`. In `run`, the prompt on the command line is the submitted prompt, and a veto exits 1 before any model call. ACP sessions are driven by the editor and fire the tool hooks only.
- `pre-compact` fires for automatic compaction and for `/compact`.

## Hook context

Each hook is run with the relevant context in its environment. Nothing is passed on stdin or as arguments.

| Variable | Set for | Value |
|----------|---------|-------|
| `NANOCODER_HOOK_EVENT` | always | The event name, e.g. `pre-tool-use` |
| `NANOCODER_CWD` | always | The session's working directory |
| `NANOCODER_SESSION_ID` | always | Identifier for this session, stable until `/clear` or `/resume` |
| `NANOCODER_TOOL_NAME` | tool events | The tool being called, e.g. `write_file` |
| `NANOCODER_TOOL_ARGS` | tool events | The tool's arguments as JSON |
| `NANOCODER_FILE` | tool events with a path argument | The file the tool acts on |
| `NANOCODER_COMMAND` | `execute_bash` | The shell command the model wants to run |
| `NANOCODER_TOOL_RESULT` | `post-tool-use` | The tool's result (truncated to 16k characters) |
| `NANOCODER_PROMPT` | `user-prompt-submit` | The submitted prompt |
| `NANOCODER_MESSAGE_COUNT` | `pre-compact` | Messages in the conversation |

Hook commands are **not** env-substituted when the config is read, so `$NANOCODER_FILE` in your `command` reaches the shell intact.

Hooks run in config order, sequentially, with the session's working directory as their cwd.

## Blocking a tool call

On `pre-tool-use` and `user-prompt-submit`, a **non-zero exit denies the action**, and the hook's stdout is handed back to the model as the reason — so it can adapt rather than retry blindly.

`.nanocoder/hooks/guard.sh`:

```bash
#!/usr/bin/env bash
case "$NANOCODER_FILE" in
  .env|.env.*|*/.env)
    echo ".env is managed outside the repo. Edit .env.example instead."
    exit 1
    ;;
esac
```

The model sees:

```
Error: Blocked by hook "no-env": .env is managed outside the repo. Edit .env.example instead.
```

This sits alongside — not inside — the approval policy: a denied tool never reaches the approval prompt or the handler at all.

The first veto ends the chain — later hooks on that event don't run.

Only a deliberate non-zero exit blocks. A hook that hangs past its `timeout` is killed, logged, and skipped, so a broken script degrades to "no hook" instead of wedging the agent. On the other events a non-zero exit is logged and the remaining hooks still run.

## Injecting context

Anything a hook prints on stdout is put in front of the model:

- `post-tool-use` stdout is appended to that tool's result inside a `<hook-output>` block, so a formatter's complaint lands on the same turn.
- `session-start` and `user-prompt-submit` stdout is buffered and prepended to your next prompt inside a `<hook-context>` block. Your transcript still shows what you typed. `/clear` drops anything undelivered.

A hook that prints nothing injects nothing.

## Security

Hooks are project-local shell commands, so `agents.config.json` in a repository is a code-execution surface — exactly like the `mcpServers` in the same file, and like `.nanocoder/tools/`. All of them are gated by the directory-trust prompt you accept the first time Nanocoder runs in a directory. Treat an untrusted repository's `agents.config.json` the way you would treat its `package.json` scripts, and use `/doctor` to see what a project has wired up.

**Quote your variables.** Your `command` is the only thing Nanocoder puts on the shell command line; everything the model influenced arrives through the environment instead, so a model-chosen path can never inject into the command itself. But once your hook expands one of those variables, normal shell rules apply — and the model picked the value. Write `biome check --write "$NANOCODER_FILE"`, not `biome check --write $NANOCODER_FILE`, so a path with a space or a `;` in it stays one argument.

## Troubleshooting

- **The hook never runs.** Check `/doctor` — an entry missing a `command` string, or filed under a misspelled event, is dropped at load time.
- **`$NANOCODER_FILE` is empty.** Only tools with a path argument set it. Use `NANOCODER_TOOL_ARGS` for anything else.
- **A veto isn't taking effect.** `pre-tool-use` blocks on a non-zero exit only. `exit 0` with a message on stdout is not a veto — on `pre-tool-use` that output is discarded.
- **The agent stalls on a hook.** Lower its `timeout`. The default is 30 seconds, which is a long time to wait on every tool call.
