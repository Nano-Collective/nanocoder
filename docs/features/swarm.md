---
title: "Swarm"
description: "Split one goal into parallel tasks, each run by its own agent in a separate Git worktree"
sidebar_order: 29
---

# Swarm

`nanocoder swarm` splits a goal into tasks that do not share files, runs one headless agent per task in its own Git worktree, and combines their changes into patches.

```bash
nanocoder swarm "add unit tests for the utils folder"
nanocoder swarm "migrate the api and ui folders to the new logger" --workers 2 --swarm-mode apply
```

## Requirements

- An interactive terminal.
- A Git repository with at least one commit. Run the command from the repository root.
- A clean working tree. Commit or stash your changes first.
- A trusted folder. Run `nanocoder` there once, or pass `--trust-directory`.

## How a run works

1. The model receives the goal and the list of tracked files, and returns up to `--workers` tasks, each with the files or directories it may change. A plan with overlapping scopes is rejected and requested again, up to three times.
2. Each task gets a worktree and a temporary branch, and a headless `nanocoder run` using the same provider and model. If `agents.config.json`, `.mcp.json` or `.env` exist in the repository root but are not tracked, they are copied into each worktree.
3. When all workers finish, each worker's changes are checked against its scope. One violation fails the whole run.
4. The patches are saved, then handled according to the swarm mode.

Workers do not see each other's changes, and tasks run in parallel only. A goal whose parts depend on each other is better handled in one session. Build output and installed dependencies such as `node_modules` are not present in the worktrees.

## Options

| Option | Default | Description |
|---|---|---|
| `--workers <1-10>` | `4` | Maximum number of parallel agents. The model may plan fewer tasks. |
| `--swarm-mode <mode>` | `review` | See below. |
| `--timeout <minutes>` | `30` | Time limit for planning and the workers. |
| `--provider`, `--model`, `--profile`, `--context-max` | | Same as for other commands. |
| `--trust-directory` | | Skip the folder trust check for this run. |

| Swarm mode | Workers run in | After the checks pass |
|---|---|---|
| `review` | auto-accept | Nothing is applied. The patch paths are printed. |
| `apply` | auto-accept | You are asked to confirm, then all patches are applied. |
| `yolo` | yolo | All patches are applied without asking. |

Applied changes are left uncommitted. They are applied only if the working tree is still clean and `HEAD` has not moved, and either every patch applies or none does.

## What workers may do

The file editing tools of a worker only accept paths inside its scope.

In `review` and `apply` mode, calls that would normally ask for approval, such as shell commands and deleting files, are refused and the worker continues without them. Tools listed in `alwaysAllow` still run. Workers therefore cannot run your tests in these modes.

In `yolo` mode every tool runs, including shell commands. The scope check on the finished changes catches edits to tracked or new files inside the worktree. It cannot see changes made outside the worktree, to ignored files, or through external services. Worktrees are not a sandbox: use [OS sandboxing](../configuration/index.md#os-sandbox) if you need one.

## Failures and cancelling

If a worker fails, the time limit is reached, or you press **Ctrl+C**, the other workers are stopped and all swarm worktrees and temporary branches are removed. Swarm never resets or cleans your working tree, so edits you make while it runs are kept. Patches from workers that had already finished are saved.

Each run keeps its plan, patches, worker logs and reports under `.nanocoder/swarm/<run-id>/`. The directory is added to `.git/info/exclude`, so it does not show up in `git status`. Delete old runs whenever you like.

If the swarm process is killed with `SIGKILL`, cleanup cannot run. Use `git worktree list`, then `git worktree remove --force <path>` and `git branch -D <branch>` for the `nanocoder-swarm-` entries.
