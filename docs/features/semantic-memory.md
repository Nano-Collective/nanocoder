---
title: "Semantic Memory"
description: "Save durable project facts and recall them automatically across sessions"
sidebar_order: 13
---

# Semantic Memory

Semantic memory lets you save durable facts about a project — architectural decisions, conventions, known issues, rejected approaches — so you don't have to re-explain them every session. Relevant memories are automatically recalled and injected into the system prompt as project context.

Memory creation is always manual and explicit. Nothing is ever saved automatically after a session; you decide what's worth remembering.

## Commands

- `/remember [--category <name>] <content>` — Save a memory directly
- `/memory list` — List all saved memories with their IDs and categories
- `/memory delete <id>` — Delete a specific memory
- `/memory clear` — Delete all memories for the current project
- `/memory propose` — Scan the current conversation for durable-sounding facts and print them as numbered proposals for review
- `/memory accept <n>` — Save proposal `n` from the most recent `/memory propose` output

### Example

```
/remember The auth module uses Clerk and avoids middleware in the edge runtime.
/remember --category codingStyle Use camelCase for all variable names.

/memory list
/memory propose
/memory accept 2
```

## Categories

Memories are grouped into: `architecture`, `bugFix`, `refactor`, `todo`, `codingStyle`, or `project` (the default, for anything that doesn't match a more specific category). `/remember` infers a category automatically from the content unless you pass `--category`.

## Recall

When you send a message, Nanocoder ranks saved memories by relevance to that message (keyword overlap, with common words filtered out) and injects the most relevant ones into the system prompt under a `## Project Context` heading, up to a token budget. Low-relevance memories are dropped rather than injected as noise.

Recall works the same way across every interface: the interactive TUI, `nanocoder run` / `--plain`, and `--acp`. Each surface shows a `Recalling N project memories...` notice when memories are injected.

Retrieval is keyword-based, not a true embeddings/vector search — the "semantic" in the name refers to the kind of facts stored (durable project knowledge), not the matching technique.

## Proposals

`/memory propose` looks back through the conversation for lines that read like durable facts (matched against the category keywords above) and prints them with their source (`explicit-user` or `conversation-inferred`) and a short evidence snippet. Nothing is saved until you run `/memory accept <n>`.

Proposals inferred purely from assistant text carry an `Inferred from conversation, no explicit user statement.` warning. If the assistant appears to be capitulating to pushback rather than stating a fact (opens with "you're right", "fair enough", etc., in response to a non-technical user message), the proposal is also flagged `Possible assistant position reversal.` — this catches the case where a model agreeing with a user's stylistic preference gets summarized into a "project convention" that was never actually decided. If you explicitly restate the same line yourself, the reversal warning is cleared, since your own statement is what actually resolves the ambiguity.

## Turning It Off

Semantic memory is on by default. Toggle it from `/settings` → **Semantic Memory**. Turning it off disables both recall (memories are no longer injected into prompts) and writes (`/remember` and `/memory accept` are refused while it's off).

## Storage and Scope

Memories are stored per-repository in a local JSON file under your app data directory, keyed by a hash of the repository's `git remote origin.url` (or its absolute path, for non-git directories). This means:

- All branches, worktrees, and local clones that share the same `origin` remote share one memory pool.
- Forks with a different `origin` get their own, separate pool.
- This scope isn't currently configurable — if you work across branches with genuinely divergent conventions in the same repository, they'll share memories.

Files are written atomically (temp file + rename) with restrictive permissions (`0600` on the file, `0700` on the directory), and nothing ever leaves your machine.
