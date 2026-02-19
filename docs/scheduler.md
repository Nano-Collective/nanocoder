# Scheduled Tasks

Nanocoder supports scheduling recurring AI tasks using cron expressions. This is useful for automating routine coding tasks like dependency updates, code reviews, or daily standup summaries.

## Quick Start

```bash
# Create a new scheduled task file
/schedule create deps-update

# Add a schedule for it
/schedule add "0 9 * * MON" deps-update

# Start the scheduler
/schedule start
```

## How It Works

Scheduled tasks are defined as markdown files in `.nanocoder/schedules/`. Each file contains a prompt that instructs the AI what to do when the schedule runs.

When a scheduled task executes, Nanocoder:
1. Loads the prompt from the schedule file
2. Runs the AI with that prompt in non-interactive mode
3. Records the execution result (success/error)
4. Logs output for later review

## Commands

### `/schedule create <name>`

Creates a new scheduled task file and prompts you to write the prompt content.

```bash
/schedule create daily-summary
```

The `.md` extension is added automatically. This opens the file in your editor for you to write the prompt.

**Schedule file format:**

```markdown
---
description: Daily standup summary
---

Provide a brief summary of recent changes from git log. Focus on:
- New features merged
- Bug fixes
- Any breaking changes
```

### `/schedule add "<cron>" <name>`

Adds a schedule for an existing task file.

```bash
# Run deps-update every Monday at 9am
/schedule add "0 9 * * MON" deps-update

# Run daily at 8am
/schedule add "0 8 * * *" daily-standup

# Run every hour
/schedule add "0 * * * *" hourly-check
```

The `.md` extension is inferred if not provided.

**Cron format:** `minute hour day-of-month month day-of-week`

| Field | Values |
|-------|--------|
| Minute | 0-59 |
| Hour | 0-23 |
| Day | 1-31 |
| Month | 1-12 |
| Weekday | 0-6 (Sun-Sat) |

### `/schedule list`

Shows all configured schedules with their cron expression and next run time.

### `/schedule remove <id>`

Removes a schedule by its ID (shown in `/schedule list`).

### `/schedule logs [id]`

Shows execution logs for schedules.

- Without ID: Shows logs for all schedules
- With ID: Shows logs for a specific schedule

### `/schedule start`

Enters scheduler mode, where Nanocoder runs in the background and executes scheduled tasks. Press `Ctrl+C` to exit.

## Storage

- **Schedule configurations**: `.nanocoder/schedules.json`
- **Schedule task files**: `.nanocoder/schedules/*.md`
- **Execution logs**: `.nanocoder/schedule-runs.json`

Consider adding these to your `.gitignore`:

```gitignore
.nanocoder/schedules.json
.nanocoder/schedule-runs.json
.nanocoder/schedules/
```

## Examples

### Dependency Update Check

```markdown
---
description: Check for outdated npm dependencies
---

Run `npm outdated` to check for outdated dependencies. Report any that have updates available but aren't yet in package.json.
```

### Code Review Reminder

```markdown
---
description: Check for pending PRs
---

Check if there are any pending pull requests that need review. List the titles and authors of open PRs.
```

### Daily Summary

```markdown
---
description: Daily git summary
---

Provide a summary of commits from the last 24 hours using git log. Group by author and highlight any security-related changes.
```

## Tips

- **Test your prompts first**: Run your prompt manually with `nanocoder run "your prompt"` before scheduling it
- **Keep prompts focused**: Scheduled tasks work best with clear, specific requests
- **Use absolute paths**: If your prompt references files, use absolute paths since the working directory may vary
- **Check logs regularly**: Monitor `/schedule logs` to ensure tasks are running successfully
