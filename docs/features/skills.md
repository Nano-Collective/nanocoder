---
title: "Skills"
description: "The unified extension model: commands, subagents, tools, and event subscriptions in one ergonomic primitive"
sidebar_order: 1
---

# Skills

A **skill** is the unit of extension in Nanocoder — the umbrella that
unifies [commands](./custom-commands.md), [subagents](./subagents.md),
and [tools](./custom-tools.md), plus the event subscriptions that fire
them. If you're adding any kind of custom behaviour to Nanocoder, this
is the page to start with; the individual command / subagent / tool
pages drill into the per-member details.

Skills come in two ergonomic forms - a single `.md` file in
`.nanocoder/commands|agents|tools/` (the **single-file** form) or a
directory under `.nanocoder/skills/` containing a `skill.yaml` and any
subset of `commands/`, `agents/`, `tools/` subdirs (the **bundle** form).

Both forms produce the same runtime data model, register into the same
registries, and surface through the same `/skills` slash command.

## Why two forms

Most extensions are a single piece: a command, a subagent, or a tool.
For those, the single-file form keeps the cost at exactly one file -
exactly how `.nanocoder/commands/`, `.nanocoder/agents/`, and
`.nanocoder/tools/` already work today.

A bundle skill is for multi-piece features. A "PR reviewer" skill wants
its subagent (the reviewer), a tool (`gh_pr_diff`), and a command
(`/review`) to ship and version together. The bundle form gives that a
home with one manifest and one shareable artifact.

## Single-file form

Drop one `.md` into the right flat dir. Frontmatter declares the
member; the file basename is the skill name.

```markdown
<!-- .nanocoder/agents/docs-agent.md -->
---
name: docs-agent
description: Watch docs and refresh outputs when source changes.
subscribe:
  - kind: file.changed
    paths: ["docs/**"]
    eventKinds: [add, change]
---

You watch the docs directory for changes...
```

The `subscribe:` block is new. When the per-project daemon is running,
it wakes this subagent whenever a file under `docs/**` changes.

## Bundle form

A directory under `.nanocoder/skills/<name>/` with `skill.yaml`:

```
.nanocoder/skills/k8s/
  skill.yaml
  commands/k8s.md
  agents/k8s-agent.md
  tools/
    k8s_pods.md
    k8s_logs.md
```

```yaml
# skill.yaml
name: k8s
description: Kubernetes operational helpers.
version: 0.2.0
author: you@example.com

subscribe:
  - kind: file.changed
    target: agent:k8s-agent
    paths: ["k8s/**/*.yaml"]

tools_visibility:
  default: scoped
```

Inside a bundle, members are aware of each other:

- A bundle's subagent automatically gets its sibling tools in its
  effective tool list. You do not list `k8s_pods` and `k8s_logs` in
  `agents/k8s-agent.md`'s `tools:` field - they are siblings.
- Scoped tools (`tools_visibility.default: scoped`, the default for
  bundles) are hidden from the global tool list - only the bundle's
  own subagent sees them.
- Set `tools_visibility.default: global` to expose tools alongside
  built-ins, MCP tools, and the existing `.nanocoder/tools/*.md`
  flat-form tools.

### How many of each member kind?

- `commands/` — **any number**. Each file auto-namespaces under the
  bundle name, so `commands/status.md` in bundle `k8s` invokes as
  `/k8s:status`. Shortcut: `commands/<bundleName>.md` (e.g.
  `commands/k8s.md`) keeps the bare bundle name (`/k8s`).
- `agents/` — **exactly one (or zero)**. The agent is the bundle's
  brain; if you need a second one, that's a second skill.
- `tools/` — **any number**. Tools are named by their frontmatter
  `name:` (snake_case), independent of the bundle name.

A multi-verb bundle is natural:

```
.nanocoder/skills/git/
  skill.yaml                # name: git
  commands/
    status.md               # invokes as /git:status
    commit.md               # invokes as /git:commit
    push.md                 # invokes as /git:push
  agents/git-agent.md       # one shared agent
  tools/
    git_log.md
    git_diff.md
```

## Event subscriptions

Subscriptions can declare on member frontmatter (target is implicit
`self`) or on the bundle manifest (target is explicit `kind:name`):

```yaml
# bundle manifest, multiple targets in one place
subscribe:
  - kind: file.changed
    target: agent:docs-agent
    paths: ["docs/**"]

  - kind: schedule.cron
    target: command:weekly-report
    cron: "0 9 * * MON"
```

v1 event kinds: `file.changed` (filter: `paths`, `eventKinds`) and
`schedule.cron` (filter: `cron`).

### `confirm: true`

Default: triggered runs execute in `headless` mode (autonomous, no
foreground prompts). Set `confirm: true` on a subscription to make the
run execute in `plan` mode instead - the subagent proposes changes
without applying them.

```yaml
subscribe:
  - kind: file.changed
    target: agent:docs-agent
    paths: ["docs/**"]
    confirm: true
```

## The daemon

Events only fire while a process is running to host them. The
interactive TUI does NOT start file watchers or cron tickers — that's
the daemon's job.

```
nanocoder daemon start      # spawn the per-project daemon detached
nanocoder daemon stop       # SIGTERM the daemon, wait for lockfile cleanup
nanocoder daemon status     # report running / not running, PID, uptime
nanocoder daemon logs       # tail .nanocoder/daemon.log (last 64KB)
nanocoder daemon install    # install per-user auto-start
nanocoder daemon uninstall  # remove the auto-start unit
```

The daemon writes a JSON lockfile at `.nanocoder/daemon.json` (PID,
socket path, start time) and an append-only log at
`.nanocoder/daemon.log`. Stale lockfiles (PID no longer alive) are
reaped automatically on the next `daemon start` or `daemon status`.

Auto-start ships for **macOS** (LaunchAgent under
`~/Library/LaunchAgents/`), **Linux** (systemd user unit under
`~/.config/systemd/user/`), and **Windows** (Task Scheduler task
registered via `schtasks /Create /XML` with an ONLOGON trigger; the XML
manifest is stored under `%LOCALAPPDATA%\nanocoder\tasks\`). All three
are namespaced by a short hash of the project path so multiple projects
each get their own daemon.

The daemon's IPC surface uses an `AF_UNIX` socket at
`.nanocoder/daemon.sock` on macOS/Linux and a named pipe at
`\\.\pipe\nanocoder-daemon-<hash>` on Windows. `nanocoder daemon stop`
prefers an IPC shutdown request (clean drain of the event loop) and
falls back to `SIGTERM` only if the daemon is unreachable, so stops are
graceful on Windows too where `SIGTERM` would otherwise be force-kill.

Internally, the daemon runs every triggered subagent in **`headless`**
mode (no foreground prompts, no `ask_user`, no `agent`). The
`confirm: true` opt-in below switches a specific subscription to plan
mode instead.

## Inspecting and creating skills

```
/skills                 list every loaded skill
/skills show k8s        details for one skill (members, subscriptions, source)
/skills create k8s      scaffold a new bundle at .nanocoder/skills/k8s/
/skills check k8s       validate a bundle without loading it
/skills promote k8s     copy a project skill up to the global level
/skills demote k8s      copy a global skill down into this project
```

`/skills create` only scaffolds **bundles**. For single-file skills, use
the existing creators:

```
/commands create my-cmd     scaffold .nanocoder/commands/my-cmd.md
/agents create my-agent     scaffold .nanocoder/agents/my-agent.md
/tools create my-tool       scaffold .nanocoder/tools/my-tool.md
```

Each of those drops a stub file in the right flat dir and chains into an
AI-assisted design conversation so the model can help fill in the
frontmatter and body.

## Sharing skills across repos

Skills load from three levels, highest priority first:

- **project** - `.nanocoder/skills/` (and the flat `commands|agents|tools/`
  dirs) in the working directory. Scoped to this repo, committed with it.
- **personal / global** - the same layout under your platform config dir
  (`~/.config/nanocoder/` on Linux, `~/Library/Preferences/nanocoder/` on
  macOS, or `$NANOCODER_CONFIG_DIR`). Available in every repo on the machine.
- **built-in** - shipped with nanocoder.

A project skill shadows a personal one of the same name, which shadows a
built-in. To reuse a skill you wrote in one repo everywhere, move it up a
level; to vendor a global or built-in skill into a repo so teammates get it,
move it down:

```
/skills promote pr-review          copy project -> global, keep both
/skills promote pr-review --move    move project -> global, remove the original
/skills demote pr-review           copy global -> project, keep both
/skills demote pr-review --move     move global -> project, remove the original
```

Notes:

- Both default to **copy**, leaving the original in place. After a copy you
  have the skill at both levels and the higher-priority one wins on the next
  load. Pass `--move` to remove the source instead.
- The copy refuses to overwrite an existing skill at the destination. Re-run
  with `--force` to replace it.
- `promote` only works on a project skill; `demote` works on a global or
  built-in skill (demoting a built-in vendors a copy you can then edit).
- Both write to disk only. Restart nanocoder for the new copy to load.

## Migration from `schedules.json`

The legacy scheduler (the `ScheduleRunner` that read
`.nanocoder/schedules.json`) has been **removed**. Cron-driven runs now
happen exclusively through skill subscriptions executed by the daemon.

Move each entry into the targeted command's frontmatter, or into a bundle
manifest:

Before:
```json
[{"cron": "0 9 * * MON", "command": "/weekly-report"}]
```

After (frontmatter form):
```markdown
<!-- .nanocoder/commands/weekly-report.md -->
---
description: Monday morning summary.
subscribe:
  - kind: schedule.cron
    cron: "0 9 * * MON"
---

Summarize last week's commits...
```

After (manifest form, inside a bundle):
```yaml
subscribe:
  - kind: schedule.cron
    target: command:weekly-report
    cron: "0 9 * * MON"
```

If `.nanocoder/schedules.json` is present when Nanocoder boots, you see
a loud warning pointing at this migration guide. The file itself is no
longer read - only its presence triggers the warning.

After migrating, run `nanocoder daemon start` (or `nanocoder daemon
install` for auto-start across reboots) to make the cron subscriptions
actually fire.
