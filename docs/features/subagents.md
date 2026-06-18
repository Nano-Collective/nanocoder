---
title: "Subagents"
description: "Delegate focused tasks to specialized AI agents that run in isolated contexts"
sidebar_order: 3
---

# Subagents

> **A subagent is one kind of skill member.** This page covers the
> subagent-specific details — system prompts, isolation, parallel
> execution. For the broader picture (how subagents combine with
> commands, tools, and event triggers in a single bundle, and how
> single-file vs bundle skills work), see **[Skills](./skills.md)**.

Subagents are specialized AI agents that the main agent can delegate tasks to. Each subagent runs in its own isolated conversation with its own system prompt, filtered tools, and optionally a different model or provider. Only the final result is returned to the main conversation, keeping your context window clean.

## How It Works

The main agent has access to an `agent` tool. When it decides a task would benefit from focused research, exploration, or specialized processing, it calls the `agent` tool with a subagent type and description. The subagent runs independently, executes tool calls as needed, and returns its findings.

You don't need to explicitly ask for a subagent — the main agent decides when delegation is appropriate based on the task.

### Parallel Execution

The main agent can call the `agent` tool multiple times in a single response. All agent calls execute in parallel for maximum efficiency. This is useful for independent research tasks — for example, exploring different parts of the codebase simultaneously.

A maximum of 5 agents can run concurrently. Excess calls receive an error and can be retried.

## Built-In Subagents

Nanocoder ships with one built-in subagent:

### explore

A codebase exploration agent. Use when you need to explore file structure, search for patterns, understand code, or gather context without filling your main conversation with search results.

```
Tools: read_file, search_file_contents, find_files, list_directory,
       lsp_get_diagnostics, git_status, git_log, git_diff
```

Use `/agents create <name>` or `/agents copy explore` to scaffold project-specific agents (e.g. a code reviewer, a test-writer, a security auditor) tailored to your codebase.

## Creating Custom Subagents

### With AI Assistance

```bash
/agents create code-reviewer
```

This creates a template at `.nanocoder/agents/code-reviewer.md` and prompts the AI to help you write the agent definition.

### By Copying a Built-In Agent

```bash
/agents copy explore
```

This copies the full definition of the `explore` agent (or any other agent) to `.nanocoder/agents/explore.md` so you can customize it. The project-level copy takes priority over the built-in, so your modifications take effect immediately.

This is the easiest way to tweak a built-in agent — adjust the system prompt, add or remove tools, change the model, etc.

### Manually

Create a markdown file in `.nanocoder/agents/` (project-level) or `~/.config/nanocoder/agents/` (user-level):

`.nanocoder/agents/code-reviewer.md`:

```markdown
---
name: code-reviewer
description: Reviews code for bugs, security issues, and style problems
model: inherit
contextWindow: 16384
tools:
  - read_file
  - search_file_contents
  - find_files
  - list_directory
---

You are a code review specialist. When given a file or directory to review:

1. Read the code carefully
2. Search for related files to understand context
3. Identify bugs, security issues, and style problems
4. Return findings with file paths and line numbers
```

## Frontmatter Reference

| Field | Required | Default | Description |
|-------|----------|---------|-------------|
| `name` | Yes | — | Unique identifier for the subagent |
| `description` | Yes | — | When to use this agent (shown to the LLM) |
| `provider` | No | parent's | Provider name from `agents.config.json`. Set this to use a different API endpoint (e.g. `ollama` for local models) |
| `model` | No | `inherit` | Model ID available on the provider. Use `inherit` to use the parent's current model |
| `contextWindow` | No | provider/model default | Override the subagent's context window in tokens (e.g. `16384`) |
| `tools` | No | all | Array of tool names to allow. If set, only these tools are available |
| `disallowedTools` | No | none | Array of tool names to block |

The body after the frontmatter is the system prompt.

## Using a Different Provider

Subagents can use a completely different LLM provider than the main agent. This is useful for running cheap/fast local models for research while using a cloud model for the main conversation:

```markdown
---
name: local-research
description: Fast local codebase research using Ollama
provider: ollama
model: ministral-3:3b
tools:
  - read_file
  - search_file_contents
  - find_files
  - list_directory
---

You are a codebase research agent. Search and read files to answer questions.
Always use your tools — never guess.
```

The `provider` must match a provider name configured in your `agents.config.json`.

If you set `contextWindow`, Nanocoder creates that subagent with its own context limit override. This is useful when a lightweight research agent should run with a smaller local-model context than your main coding agent. For Ollama providers, this override is also forwarded to the API request as `options.num_ctx`, so the smaller limit affects the actual model runtime too.

## Priority and Overrides

Subagent definitions are loaded from three sources in priority order:

1. **Project-level** (`.nanocoder/agents/`) — highest priority
2. **User-level** (`~/.config/nanocoder/agents/`) — medium priority
3. **Built-in** — lowest priority

A project-level agent with the same `name` as a built-in or user-level agent overrides it.

## Security

- Subagent tools respect the same approval rules as the main agent. Write tools and bash commands prompt the user for approval unless they are in the `alwaysAllow` list or the session is in auto-accept/yolo mode.
- The `tools` key in the agent definition controls which tools the subagent can access. Use this to restrict subagents to only the tools they need.
- The `alwaysAllow` setting in `agents.config.json` applies to tools within subagents, so you can configure which tools run without prompts.

## Development Modes and Tune Profiles

### Plan Mode

In plan mode, subagents can run but any write tools they attempt will require user approval (same as the main agent in plan mode). The built-in agents only have read tools configured, so they work seamlessly in plan mode.

### Scheduler Mode

Subagents are not available in scheduler mode. The `agent` tool is excluded because subagent execution requires user approval, which is not possible in non-interactive scheduler runs.

### Tune Profiles

The `agent` tool is included in both `full` and `minimal` tune profiles, so subagents are always available regardless of which profile you use. The subagent prompt section in the system prompt is only included when the `agent` tool is active.

## Managing Agents

### List All Agents

```bash
/agents
```

Shows all available subagents with their source (built-in vs custom), model, and tool count.

### View Agent Details

```bash
/agents show explore
```

Displays the full definition of an agent — description, source, provider, model, tools, and system prompt.

### Copy an Agent for Customization

```bash
/agents copy explore
```

Copies the agent definition to `.nanocoder/agents/<name>.md`. The project-level copy takes priority immediately, so you can edit the file and the changes take effect on the next agent invocation.

### Create a New Agent

```bash
/agents create my-agent
```

Creates a template and prompts the AI to help you write the definition.

## Live Progress

During subagent execution, a progress indicator shows:
- The subagent name and task description
- Number of tool calls made
- Estimated token count

When multiple agents run in parallel, each agent shows its own progress row. The progress updates in real-time as the agents work.
