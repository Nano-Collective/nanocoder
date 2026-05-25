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

The new model attaches a cron trigger directly to a command or a bundle
manifest. The [per-project daemon](./skills.md#the-daemon) wakes the
target when the schedule fires.

## What `/schedule` does now

`/schedule` is **read-only** — it lists the cron subscriptions currently
loaded from skill frontmatter and bundle manifests so you can see what
will fire and when. There is no longer a `create`, `add`, `remove`,
`start`, or `logs` subcommand.

To add, remove, or edit a cron trigger, edit the source `.md` or
`skill.yaml` file directly. Restart the daemon (`nanocoder daemon stop`
then `nanocoder daemon start`) to pick up the change.

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

If `.nanocoder/schedules.json` is still present when Nanocoder boots, a
loud deprecation warning points at this page. The file itself is no
longer read.

For the full subscription syntax (paths, eventKinds, confirm, etc.) and
daemon lifecycle, see **[Skills](./skills.md)**.
