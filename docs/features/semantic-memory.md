---
title: "Semantic Memory"
description: "Save durable project facts and recall them automatically across sessions"
sidebar_order: 13
---

# Semantic Memory

Semantic memory lets you save durable facts about a project - architectural decisions, conventions, known issues, rejected approaches - so you don't have to re-explain them every session. Relevant memories are automatically recalled and injected into the system prompt as project context.

Memory creation is always manual and explicit. Nothing is ever saved automatically after a session; you decide what's worth remembering.

## Commands

- `/remember [--category <name>] <content>` - Save a memory directly. `-c` is a short form of `--category`.
- `/memory list` - List all saved memories with their short IDs and categories. `/memory ls` is an alias, and a bare `/memory` with no subcommand does the same thing.
- `/memory delete <id>` - Delete a specific memory. `/memory rm` is an alias.
- `/memory clear` - Delete all memories for the current project.
- `/memory propose` - Scan the recent conversation for durable-sounding facts and print them as numbered proposals for review.
- `/memory accept <n>` - Save proposal `n` from the most recent `/memory propose` output.

### Example

```
/remember The auth module uses Clerk and avoids middleware in the edge runtime.
/remember -c codingStyle Use camelCase for all variable names.

/memory list
/memory delete 18d51c0d
/memory propose
/memory accept 2
```

### Memory IDs

`/memory list` prints an 8-character short ID for each memory, which is what you pass to `/memory delete`. The full UUID still works, as does any unambiguous prefix of either. If a prefix matches more than one memory, the command reports the ambiguity and deletes nothing rather than guessing.

## Categories

Memories are grouped into: `architecture`, `bugFix`, `refactor`, `todo`, `codingStyle`, or `project` (the default, for anything that doesn't match a more specific category). `/remember` infers a category automatically from the content unless you pass `--category`.

## Recall

When you send a message, Nanocoder ranks saved memories by relevance to that message (keyword overlap, with common words filtered out) and injects the most relevant ones into the system prompt under a `## Project Context` heading, up to a token budget. Low-relevance memories are dropped rather than injected as noise.

Retrieval is keyword-based, not a true embeddings/vector search. The "semantic" in the name refers to the kind of facts stored (durable project knowledge), not the matching technique.

### Where recall is active

Recall runs on:

- the interactive TUI
- `nanocoder run` / `--plain`
- `--acp`
- subagent runs (the `agent` tool)
- daemon-triggered skill runs (they use the same subagent executor)

The TUI, plain shell, and ACP print `Recalling N project memories...` when memories are injected. Subagent and daemon runs inject the same block silently, since there is no chat UI to attach that notice to.

### Tuning the budget

Two settings bound how much of the context window project context may consume. Both are adjustable from `/settings` -> **Advanced**, which cycles through common presets, or by editing `nanocoder-preferences.json` directly for any value in range.

| Preference key | Default | Range | Meaning |
|---|---|---|---|
| `semanticMemoryEnabled` | `true` | boolean | Master switch for recall and writes |
| `semanticMemoryTokenBudget` | `240` | 40 - 4000 | Approximate token ceiling for the injected block |
| `semanticMemoryLimit` | `8` | 1 - 50 | Maximum memories considered for one prompt |

Values outside the supported range are clamped rather than rejected. On a small local model the 240-token default is a meaningful slice of the window, so lowering it is often the right call.

## Proposals

`/memory propose` looks back through the recent conversation for lines that read like durable facts (matched against the category keywords above) and prints them with their source (`explicit-user` or `conversation-inferred`) and a short evidence snippet. Nothing is saved until you run `/memory accept <n>`.

The scan covers the last 40 messages and prints at most 20 proposals, so a long session doesn't produce a list too large to review. Proposals without warnings are listed first. The printed numbering is fixed for as long as that list stands: accepting one proposal does not renumber the others, and accepting the same number twice is refused rather than repeated. Running `/clear` discards the list, since its evidence refers to a conversation you can no longer see.

### Warnings

Proposals inferred purely from assistant text carry an `Inferred from conversation, no explicit user statement.` warning.

A proposal is additionally flagged `Possible assistant position reversal.` when the assistant turn looks like a concession to pressure rather than to evidence. That means the turn was preceded by a user message carrying no code, file path, or error output, and the turn either contradicts an earlier assistant turn on the same subject or opens with an agreement phrase. Tool-call turns (including ones that also have narration) and short "let me look at the file" turns are stepped over, so the check still works in a normal agentic session where the assistant reads files between turns. CamelCase words and the bare word "error" in ordinary prose do not count as technical evidence.

This catches the case where a model agreeing with a user's stylistic preference gets summarized into a "project convention" that was never actually decided. If you explicitly restate the same line yourself, the reversal warning is cleared, since your own statement is what actually resolves the ambiguity.

The check is a heuristic tuned to over-flag rather than miss: it only adds a warning to a proposal you are already reviewing by hand, so a spurious warning costs you a moment's attention while a missed one costs you a false project convention.

## Turning It Off

Semantic memory is on by default. Toggle it from `/settings` -> **Advanced** -> **Semantic Memory**. Turning it off disables both recall (memories are no longer injected into prompts) and writes (`/remember` and `/memory accept` are refused while it's off).

## Storage and Scope

Memories are stored per-repository in a local JSON file under the Nanocoder data directory:

| Platform | Path |
|---|---|
| macOS | `~/Library/Application Support/nanocoder/memory/` |
| Linux | `~/.local/share/nanocoder/memory/` (or `$XDG_DATA_HOME/nanocoder/memory/`) |
| Windows | `%APPDATA%\nanocoder\memory\` |

Setting `NANOCODER_DATA_DIR` overrides all of these.

The filename is a hash of the repository's `git remote origin.url`, or of its absolute path for non-git directories. This means:

- All branches, worktrees, and local clones that share the same `origin` remote share one memory pool.
- Forks with a different `origin` get their own, separate pool.
- This scope isn't currently configurable. If you work across branches with genuinely divergent conventions in the same repository, they'll share memories.

Each repository file is capped at 500 memories. Saving past that drops the oldest entries (by timestamp) so the file cannot grow without bound. Writes to the same file are serialized across manager instances in one process, and locked across processes (TUI and daemon).

Files are written atomically (temp file + rename) with restrictive permissions (`0600` on the file, `0700` on the directory), and nothing ever leaves your machine. Memory content is fenced when injected into the system prompt, with the fence widened as needed so content containing backticks cannot break out of it.
