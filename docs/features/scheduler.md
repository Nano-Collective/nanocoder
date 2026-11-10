---
title: "Scheduler"
description: "Recurring tasks are now a skill subscription, not a separate scheduler"
sidebar_order: 6
---

# Scheduled Tasks

> **Scheduled tasks are now a skill feature.** The standalone scheduler
> (`/schedule create`, `/schedule add`, `/schedule start`, the
> `.nanocoder/schedules.json` file) has been **removed**. Cron-driven
> runs happen through **[skill subscriptions](./skills.md#event-subscriptions)**
> executed by the per-project daemon. This page is the migration
> pointer; everything else lives in [Skills](./skills.md).

## What replaced it

The new model attaches a cron trigger directly to a command, an agent, or a
bundle manifest. The [per-project daemon](./skills.md#the-daemon) wakes the
target when the schedule fires. A command target is rendered (with no
arguments, so parameter defaults apply) and run as an unattended agent run
in `headless` mode, the same way the old scheduler ran it.

## What `/schedule` does now

`/schedule` is **read-only** — it lists the cron subscriptions currently
loaded from skill frontmatter and bundle manifests, each with its cron
expression, a short readable summary of it (for example "Mon at 9:00"), and its
target. It does not show the next run time. There is no
longer a `create`, `add`, `remove`, `start`, or `logs` subcommand.

To add, remove, or edit a cron trigger, edit the source `.md` or
`skill.yaml` file directly, then re-trust the folder and restart the
daemon. Subscriptions are part of the folder's trust fingerprint, so after
the edit `daemon start` refuses to run ("changed since you trusted it")
until you trust the folder again: run `nanocoder` interactively there once,
or run `nanocoder trust --status` and then
`nanocoder trust --grant <fingerprint>`. Then run `nanocoder daemon stop`
followed by `nanocoder daemon start` to pick up the change.

## Migration

If you previously used `.nanocoder/schedules.json`, move each entry into
the targeted command's frontmatter, or into a bundle manifest.

### Before (legacy `schedules.json`)

```json
// .nanocoder/schedules.json
[{"cron": "0 9 * * MON", "command": "/weekly-report"}]
```

### After (single-file form)

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

### After (bundle manifest)

```yaml
# .nanocoder/skills/reports/skill.yaml
name: reports
description: Weekly status reports.
subscribe:
  - kind: schedule.cron
    target: command:weekly-report
    cron: "0 9 * * MON"
```

Then start the daemon so subscriptions fire:

```bash
nanocoder daemon start
```

`daemon start` refuses to run in a directory you haven't trusted yet. Run
`nanocoder` interactively there once to accept the disclaimer, run
`nanocoder trust --status` and then `nanocoder trust --grant <fingerprint>`,
or pass `--trust-directory` to skip the check for that run. See
**[Skills](./skills.md#the-daemon)** for the trust options in full.

If `.nanocoder/schedules.json` is still present when Nanocoder boots, a
loud deprecation warning points at this page. The file itself is no
longer read.

For the full subscription syntax (paths, eventKinds, confirm, etc.) and
daemon lifecycle, see **[Skills](./skills.md)**.
