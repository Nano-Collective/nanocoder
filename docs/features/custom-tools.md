---
title: "Custom Tools"
description: "Define your own model-callable tools as markdown files with input schemas, validators, and shell-script bodies"
sidebar_order: 4
---

# Custom Tools

> **A custom tool is one kind of skill member.** This page covers
> tool-specific details — input schemas, validators, approval policy,
> shell-script bodies. For the broader picture (scoping a tool to one
> subagent inside a bundle, or wiring tools into a bigger skill), see
> **[Skills](./skills.md)**.

Custom tools let the model call your own scripts. Drop a markdown file into `.nanocoder/tools/`, declare the parameters it accepts, and write the shell command. The tool shows up alongside built-ins (`read_file`, `execute_bash`, etc.) — the model can call it, you confirm execution, the script runs, and stdout comes back as the result.

This sits between [custom commands](./custom-commands.md) (markdown prompts injected as context, no execution) and MCP servers (full tool execution but requires running a separate process). If you just want a lightweight wrapper around `kubectl`, `gh`, `jq`, or any other CLI, custom tools are the right level.

## Quick Start

Use the slash command to scaffold a new tool with AI assistance:

```
/tools create k8s-pods
```

This creates `.nanocoder/tools/k8s-pods.md` with a template and asks the model to help you fill in the parameters, body, and approval policy. Or write the file yourself:

`.nanocoder/tools/k8s-pods.md`:

```markdown
---
name: k8s_pods
description: List pods in a Kubernetes namespace. Returns kubectl output as text.
parameters:
  namespace:
    type: string
    required: true
    description: The Kubernetes namespace
    pattern: '^[a-z0-9-]+$'
    maxLength: 63
  selector:
    type: string
    description: Optional label selector (e.g. "app=api")
approval: never
read_only: true
---

kubectl get pods -n {{ namespace }} {{# selector }}-l "{{ selector }}"{{/ selector }}
```

Restart Nanocoder. The model can now call `k8s_pods({ namespace: "default" })`. Run `/tools` to see all loaded tools by source.

## File Structure

Custom tools live in `.nanocoder/tools/` in your project root, or in `~/.config/nanocoder/tools/` for personal tools that travel with your machine. Project tools override personal tools by name.

```
.nanocoder/tools/
  k8s-pods.md         -> k8s_pods
  jira-ticket.md      -> jira_ticket
```

One file, one tool. Phase 1 only supports `.md` files; `.ts` and `.js` files are reserved for a later phase.

## Frontmatter Reference

All fields:

```yaml
---
name: snake_case_name           # required, must match ^[a-z][a-z0-9_]*$
description: Description shown to the LLM   # required
parameters:                     # optional, default {}
  param_name:
    type: string | number | integer | boolean | array
    description: shown to the LLM
    required: true | false      # default false
    default: any                # used when not provided
    enum: [a, b, c]             # restrict values
    pattern: '^regex$'          # string only
    minLength: 1                # string only
    maxLength: 100              # string only
    min: 0                      # number/integer only
    max: 1000                   # number/integer only
    items: {type: string}       # array only — type of each element
approval: never | always | destructive   # default: always
read_only: true | false         # default: (approval == never)
timeout_ms: 30000               # default 30000, max 300000
cwd: ./scripts                  # default: project root; supports ${VAR}; must stay in the project
env:
  FOO: bar                      # extra env vars; values support ${VAR}
shell: bash | sh                # default: bash if available, else sh; Windows: ComSpec/cmd.exe
---

# Body is a shell script. See "Template Syntax" below.
```

### Approval

- `approval: never` — runs without confirmation (still subject to mode-based overrides).
- `approval: always` (default) — always prompts the user.
- `approval: destructive` — prompts in `normal` mode but auto-approves in `auto-accept` and `yolo` modes, matching how built-in file-mutation tools behave.

Tools listed in the top-level `alwaysAllow` config field skip the prompt regardless. Tools listed in `disabledTools` don't load at all.

### read_only

Tools marked `read_only: true` can run in parallel with other read-only tools. The default is `true` when `approval: never`, otherwise `false`. Set it explicitly if your tool reads state but still needs approval, or vice versa.

### Working directory

`cwd` defaults to the project root. Relative paths resolve against it, and `${VAR}` is substituted from the environment first.

The resolved directory has to stay inside the project once symlinks are resolved. A `cwd` that escapes - an absolute path elsewhere, `${HOME}`, a `../` traversal, or a `./scripts` that is a symlink pointing out of the repo - fails the tool call with `Custom tool cwd escapes the project directory`. The tool is not run somewhere else instead: silently relocating a script that expects a scratch directory is how a `rm -rf ./*` body ends up pointed at your project.

A `cwd` that does not exist is not an error - it falls back to the project root, so a tool referencing a directory a teammate has not checked out yet still runs.

This is containment against misconfiguration, not a sandbox. The script body is arbitrary shell and can `cd` wherever it likes; the check only governs where the shell starts.

## Template Syntax

The body is a shell script with two placeholder forms:

- **`{{ name }}`** — substitutes `args[name]`, POSIX-quoted. Arrays expand to space-separated quoted tokens. Not cmd-safe; see below.
- **`{{# name }}…{{/ name }}`** — section: included only when `args[name]` is truthy (non-empty string, non-empty array, non-zero number, `true`, etc.). Nested sections are supported.
- **`{{^ name }}…{{/ name }}`** — inverted section: included only when `args[name]` is falsy/empty (the complement of `{{# name }}`).

All substituted values are wrapped in POSIX single quotes and any embedded single quotes are escaped. That is shell-safe under bash/sh. It is **not** shell-safe under cmd.exe: cmd does not treat `'` as a quote, so `type {{ file }}` becomes `type 'notes.txt'` (file not found) and `&`, `|`, `>`, `^`, `%VAR%` in a value can break out. Per-shell quoting in `renderValue` is a follow-up (#1084); until then the default Windows shell is cmd.

This blocks shell injection through parameter values on POSIX:

```markdown
echo {{ name }}
```

With `args = { name: "; rm -rf /; #" }` the rendered body becomes:

```sh
echo '; rm -rf /; #'
```

`echo` sees one argument, not three commands.

## Execution

When the tool runs:

1. Parameters are validated against the declared schema. Validation errors (missing required params, wrong types, pattern mismatch, etc.) come back as `⚒ Missing required parameter: foo`-style messages without invoking the script.
2. The body is rendered, then handed to the chosen shell (`-c` for bash/sh, `/d /s /c` for cmd.exe). `shell: bash` / `shell: sh` still spawn `/bin/bash` or `/bin/sh` even on Windows, which typically fails with "Custom tool failed to start" if those binaries are missing.
3. `cwd` and `env` are resolved (with `${VAR}` and `${VAR:-default}` substitution against `process.env`). See [Working directory](#working-directory) for the containment rules.
4. The script runs with `timeout_ms` enforcement.
5. On exit code 0, stdout (and any stderr) is returned to the model, truncated at the standard output limit.
6. On non-zero exit, the conversation surfaces `Custom tool failed (exit N): <stderr>` to the model.

## Mode Behavior

| Mode | Custom tool behavior |
| ---- | -------------------- |
| `normal` | All custom tools available; approval policy applies. |
| `auto-accept` | Same as normal, but `destructive` approval auto-approves. |
| `yolo` | All tools auto-approve. |
| `plan` | Only `approval: never` + `read_only: true` tools are available. |
| `scheduler` (cron) | Only `approval: never` tools are available; nothing that needs a human prompt. |

## Slash Commands

- `/tools` — list every registered tool grouped by source (built-in, MCP, custom). Useful for confirming your file got picked up.
- `/tools create <name>` — scaffold a new custom tool under `.nanocoder/tools/<name>.md` and start an AI-assisted session to fill it in. Dashes in the filename become underscores in the tool name (`k8s-pods` → `k8s_pods`).

## Security Model

A custom tool runs with your full shell privileges. The trust boundary is "you wrote this file or you trust the repo it came from" — the same model as `.nanocoder/commands/`, `.envrc`, or `package.json` scripts. Parameter values are POSIX-quoted, which is not a cmd.exe injection barrier. The script body itself is whatever you wrote: if you put `rm -rf /` in there, it will run.

Project tools sit in `.nanocoder/tools/` and travel with the repo; personal tools sit in `~/.config/nanocoder/tools/` and don't. Treat custom tools from an unfamiliar repo with the same skepticism you'd apply to running its install script.

## What This Is Not

- **Not an MCP replacement.** MCP is for tools that need their own process, state, or are shared across multiple Nanocoder users. Custom tools are for project-local helpers.
- **Not a sandbox.** No isolation; full user privileges.
- **Not a distribution mechanism.** No registry, no `nanocoder install`. Copy files between repos manually.
