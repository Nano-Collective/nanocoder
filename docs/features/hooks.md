---
title: "Lifecycle Hooks"
description: "Run your own shell commands at fixed points in the agent loop — deterministic, token-free, and able to veto a tool call"
sidebar_order: 15
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
| `timeout` | no | Milliseconds before the hook is killed. Defaults to 30000, except `session-end` (see below). |
| `name` | no | Label shown in transcripts, error messages, and `/doctor`. Defaults to the command. |

Entries without a usable `command` string are dropped with an error in the log rather than failing the session, and an unknown event name is ignored the same way. `/doctor` prints everything that actually loaded, so you can see what is wired up.

**Project config wins outright — hooks are not merged.** Like the rest of `agents.config.json`, the nearest `hooks` block replaces the one above it rather than combining with it. A project that defines any hook at all disables *every* global hook, including a global `pre-tool-use` policy. If you rely on a global rule, repeat it in the projects that define their own hooks.

## Lifecycle points

| Event | Fires | Can veto |
|-------|-------|----------|
| `session-start` | Once, as the session initializes | no |
| `session-end` | During graceful shutdown, before the UI tears down | no |
| `user-prompt-submit` | Before a chat prompt is sent to the model | **yes** |
| `pre-tool-use` | Before a tool executes, ahead of any approval prompt | **yes** |
| `post-tool-use` | After a tool returns, **including when it fails** | no |
| `pre-compact` | Before context compaction, automatic or `/compact` | no |

`user-prompt-submit` fires for chat prompts only. A slash command (`/compact`) and a `!` bash passthrough (`!ls`) are local actions that never reach the model, and prefixing either one would break the routing that recognises it. Neither fires the hook, and neither consumes buffered context — it stays queued for the next prompt that actually goes to the model. Leading whitespace makes no difference: `  /compact` is still a slash command.

"Chat prompt" means anything dispatched to the model as a user turn, including the prompt Nanocoder sends on your behalf when you approve a plan in plan mode. A `user-prompt-submit` veto stops that turn the same way it stops one you typed.

Surfaces:

- `pre-tool-use` and `post-tool-use` fire everywhere tools run: the interactive TUI (including streamed `execute_bash`), `nanocoder run`, the `--plain` shell, ACP, and subagents.
- `post-tool-use` fires for every call that produces a result, successful or not — a handler that threw, a validation failure, malformed arguments. An audit-log hook therefore sees the failures too, which is usually the point. A call refused by `pre-tool-use` is the one exception: it never ran, so `post-tool-use` does not fire for it.
- `session-start`, `session-end`, and `user-prompt-submit` fire in the interactive TUI and in `run` / `--plain`. In `run`, the prompt on the command line is the submitted prompt, and a veto exits 1 before any model call. ACP sessions are driven by the editor and fire the tool hooks only.
- `pre-compact` fires for automatic compaction and for `/compact`.

### `session-end` runs on a shutdown budget

`session-end` fires inside graceful shutdown, which races *every* shutdown handler — the session autosave flush and the UI teardown included — against a single budget (5 seconds by default, `NANOCODER_DEFAULT_SHUTDOWN_TIMEOUT`) and then exits the process. The general 30-second default is unreachable there, so `session-end` hooks default to a **2-second** timeout instead, low enough to finish and still leave the rest of the shutdown room to run.

Keep them short. If you need longer, raise `NANOCODER_DEFAULT_SHUTDOWN_TIMEOUT` as well as the hook's own `timeout` — raising only the hook's does nothing, because the process exits first. Anything genuinely slow (uploading a transcript, say) is better started detached than waited on.

## Hook context

Each hook is run with the relevant context in its environment. Nothing is passed on stdin or as arguments.

| Variable | Set for | Value |
|----------|---------|-------|
| `NANOCODER_HOOK_EVENT` | always | The event name, e.g. `pre-tool-use` |
| `NANOCODER_CWD` | always | The project root — where the hook itself runs |
| `NANOCODER_SESSION_CWD` | always | Where the agent's shell currently is (a `cd` in `execute_bash` moves this) |
| `NANOCODER_SESSION_ID` | always | Identifier for this session, stable until `/clear` or `/resume` |
| `NANOCODER_TOOL_NAME` | tool events | The tool being called, e.g. `write_file` |
| `NANOCODER_TOOL_ARGS` | tool events | The tool's arguments as JSON |
| `NANOCODER_FILE` | tool events with a path argument | The file the tool acts on |
| `NANOCODER_COMMAND` | `execute_bash` | The shell command the model wants to run |
| `NANOCODER_TOOL_RESULT` | `post-tool-use` | The tool's result (truncated to 16k characters) |
| `NANOCODER_PROMPT` | `user-prompt-submit` | The submitted prompt |
| `NANOCODER_MESSAGE_COUNT` | `pre-compact` | Messages in the conversation |

Hook commands are **not** env-substituted when the config is read, so `$NANOCODER_FILE` in your `command` reaches the shell intact.

Hooks run in config order, sequentially, **with the project root as their cwd** — not the agent's current shell directory. A hook is defined in project config, so a relative `command` like `.nanocoder/hooks/guard.sh` has to keep resolving after the model has `cd`-ed somewhere else. Read `NANOCODER_SESSION_CWD` when you want to act on where the shell actually is.

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

This sits alongside — not inside — the approval policy. In the interactive TUI and in subagents the gate runs *before* the approval decision, so a denied tool never renders a confirmation prompt and never reaches the handler; you see the denial, not a diff preview you have to approve first.

The one surface where the order differs is ACP: the editor owns the permission request there and issues it before Nanocoder runs the tool, so an editor prompt can appear for a call the hook then refuses. The call is still blocked, and the denial still goes back to the model as the reason.

The gate is also applied again at each execution boundary (`processToolUse`, the streaming bash path, the subagent loop), so no surface can reach a handler ungated. The hook itself still runs exactly once per tool call — a hook with side effects, like an audit log, records one line per call, not one per layer.

The first veto ends the chain — later hooks on that event don't run.

Only a deliberate non-zero exit blocks. A hook that hangs past its `timeout` is killed, logged, and skipped, so a broken script degrades to "no hook" instead of wedging the agent. On the other events a non-zero exit is logged and the remaining hooks still run.

Killing a hook kills what it started. The command runs under a shell, so signalling that shell alone would leave the grandchildren of a compound command (`a && b`, a pipeline) running after the agent has moved on. Hooks are spawned into their own process group on POSIX and reaped with `taskkill /T` on Windows, so the whole tree goes.

## Injecting context

Anything a hook prints on stdout is put in front of the model:

- `post-tool-use` stdout is appended to that tool's result inside a `<hook-output>` block, so a formatter's complaint lands on the same turn. The combined result is re-capped afterwards, so a chatty hook cannot push a tool result past the usual truncation limit.
- `session-start` and `user-prompt-submit` stdout is buffered and prepended to your next prompt inside a `<hook-context>` block. Your transcript still shows what you typed. `/clear` drops anything undelivered.

A hook that prints nothing injects nothing.

`session-start` does not hold up the UI — it runs in the background while the session finishes initializing. It is only waited on at the point it matters, which is the first prompt you submit: if the hook is still running, that submission waits for it rather than letting the context slip to prompt two. So keep `session-start` hooks fast, and give anything genuinely slow its own short `timeout` — the default is 30 seconds, and it is your first prompt that pays for it.

## Security

Hooks are project-local shell commands, so `agents.config.json` in a repository is a code-execution surface — exactly like the `mcpServers` in the same file, and like `.nanocoder/tools/`. All of them are gated by the directory-trust prompt you accept the first time Nanocoder runs in a directory. Treat an untrusted repository's `agents.config.json` the way you would treat its `package.json` scripts, and use `/doctor` to see what a project has wired up.

**Hooks inherit Nanocoder's whole environment.** The `NANOCODER_*` variables are *added* to `process.env`, not a replacement for it, so a hook can read every provider API key, token, and secret the agent itself was started with. That is what makes ordinary hooks work — `git`, `biome`, and `docker` all need their usual environment — but it means a hook can exfiltrate credentials as easily as it can format a file. This is the same trust you extend to an `mcpServers` entry in the same file, which is spawned with the same environment; treat it the same way. If a hook does not need the secrets, unset them in the hook itself (`env -u ANTHROPIC_API_KEY …`) rather than assuming it cannot see them.

**Quote your variables.** Your `command` is the only thing Nanocoder puts on the shell command line; everything the model influenced arrives through the environment instead, so a model-chosen path can never inject into the command itself. But once your hook expands one of those variables, normal shell rules apply — and the model picked the value. Write `biome check --write "$NANOCODER_FILE"`, not `biome check --write $NANOCODER_FILE`, so a path with a space or a `;` in it stays one argument.

## Troubleshooting

- **The hook never runs.** Check `/doctor` — an entry missing a `command` string, or filed under a misspelled event, is dropped at load time.
- **`$NANOCODER_FILE` is empty.** Only tools with a path argument set it. Use `NANOCODER_TOOL_ARGS` for anything else.
- **A veto isn't taking effect.** `pre-tool-use` blocks on a non-zero exit only. `exit 0` with a message on stdout is not a veto — on `pre-tool-use` that output is discarded.
- **The agent stalls on a hook.** Lower its `timeout`. The default is 30 seconds, which is a long time to wait on every tool call.
- **A `session-end` hook never finishes.** It is bounded by the shutdown budget, not by its own `timeout` — see [`session-end` runs on a shutdown budget](#session-end-runs-on-a-shutdown-budget).
- **A global hook stopped working in one project.** That project defines its own `hooks` block, and hooks are not merged — the nearest one wins outright.
- **`session-start` context never appeared.** It is prepended to your next *chat* prompt. A slash command or a `!` command leaves it queued.
- **The first prompt of a session hangs.** A slow `session-start` hook is still running — the first submission waits for it so the context isn't lost. Give it a shorter `timeout`.
- **An editor shows me a permission prompt for a tool the hook blocks.** ACP only: the editor asks before Nanocoder runs the tool. The veto still lands, and the tool still doesn't run.
