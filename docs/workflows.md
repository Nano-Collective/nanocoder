# Nanocoder Workflows

> Practical workflows you can follow in Nanocoder, derived from the codebase features and documentation.

---

## Table of Contents

- [First-Time Setup](#first-time-setup)
- [Daily Coding Workflow](#daily-coding-workflow)
- [Plan → Execute Workflow](#plan--execute-workflow)
- [Non-Interactive / CI Workflow](#non-interactive--ci-workflow)
- [Local-Model Workflow](#local-model-workflow)
- [Multi-Provider Workflow](#multi-provider-workflow)
- [Skill Development Workflow](#skill-development-workflow)
- [Daemon & Scheduled Task Workflow](#daemon--scheduled-task-workflow)
- [VS Code Integration Workflow](#vs-code-integration-workflow)
- [Session Management Workflow](#session-management-workflow)
- [Context Management Workflow](#context-management-workflow)
- [Checkpoint Experimentation Workflow](#checkpoint-experimentation-workflow)
- [Project Onboarding Workflow](#project-onboarding-workflow)
- [Code Review Workflow](#code-review-workflow)
- [Multi-Agent Research Workflow](#multi-agent-research-workflow)

---

## First-Time Setup

The end-to-end path from zero to a working session.

```
1. Install
   npm install -g @nanocollective/nanocoder

2. Configure providers (pick one)
   ┌────────────────────────────────────────────────────────┐
   │  Option A: Interactive wizard                          │
   │    nanocoder                                           │
   │    → /setup-providers                                  │
   │    → Choose template → enter API key/base URL          │
   │                                                        │
   │  Option B: Manual config                               │
   │    Create agents.config.json with provider definition  │
   └────────────────────────────────────────────────────────┘

3. (Optional) Configure MCP servers
   /setup-mcp → choose template → enter credentials

4. (Optional) Initialize project context
   /init → generates AGENTS.md from project analysis

5. Start coding
   Type your request → Enter
```

### Minimal `agents.config.json` for Ollama

```json
{
  "providers": [
    {
      "name": "Ollama",
      "baseUrl": "http://localhost:11434/v1",
      "models": ["qwen2.5-coder:7b"]
    }
  ]
}
```

### Minimal `agents.config.json` for OpenRouter

```json
{
  "providers": [
    {
      "name": "OpenRouter",
      "baseUrl": "https://openrouter.ai/api/v1",
      "apiKey": "${OPENROUTER_API_KEY}",
      "models": ["anthropic/claude-sonnet-4"]
    }
  ]
}
```

---

## Daily Coding Workflow

The typical interactive session pattern.

```
1. Launch
   $ cd my-project
   $ nanocoder

2. Chat with AI
   "Refactor the authentication module to use JWT"
   → AI reads files, proposes changes, you approve

3. Provide context
   @src/auth/handler.ts What does this middleware do?
   !git log --oneline -5
   @src/auth/types.ts:10-30

4. Switch modes as needed
   Shift+Tab  →  normal → auto-accept → yolo → plan → normal ...

5. Track tasks
   /tasks add Implement JWT signing
   /tasks add Update middleware
   /tasks add Add tests

6. Save and resume later
   /rename "JWT refactor"
   → Session auto-saves every 30 seconds
   → Resume later with /resume
```

---

## Plan → Execute Workflow

Two-phase approach for complex changes. Use plan mode to understand the codebase and produce a strategy, then switch to execution.

```
Phase 1: PLAN
───────────────────────────────────────
1. Shift+Tab until status bar shows "plan"

2. Describe the task
   "We need to migrate from REST to GraphQL for the user API.
    Analyze the current codebase and create a detailed plan."

3. AI explores with read-only tools:
   • read_file → understand existing code
   • find_files → locate relevant files
   • search_file_contents → trace dependencies
   • git_log → understand recent changes

4. AI produces a structured plan:
   • Summary of what needs to happen
   • Files to modify/create/delete
   • Step-by-step approach (numbered)
   • Dependencies and risks
   • Open questions

5. Review the plan in the conversation

Phase 2: EXECUTE
───────────────────────────────────────
6. Shift+Tab back to normal or auto-accept

7. "Execute the plan from step 1"

8. AI proceeds with the full tool set:
   • string_replace → make targeted edits
   • write_file → create new files
   • execute_bash → run tests
   • git_commit → commit changes
```

---

## Non-Interactive / CI Workflow

For automation, scripts, git hooks, and CI pipelines.

```bash
# Basic: single task
nanocoder run "Fix the TypeScript errors in src/"

# With mode override
nanocoder --mode yolo run "Update all dependencies and run tests"

# Plan only (no changes)
nanocoder --mode plan run "Analyze the security of the auth module"

# In a CI pipeline
- name: Code Review
  run: nanocoder --mode plan run "Review the changes in this PR for bugs"

# In a git hook
nanocoder run "Ensure all new files have proper exports"

# Pipe-friendly output
nanocoder run "List all TODO comments" >> todos.txt
```

### Exit Codes

| Code | Meaning |
|------|---------|
| 0 | Success |
| 1 | Tool approval required (mode blocked execution) |

---

## Local-Model Workflow

Running entirely on your machine with zero outbound traffic.

```
1. Start local server (e.g., Ollama)
   $ ollama serve
   $ ollama pull qwen2.5-coder:7b

2. Configure provider
   /setup-providers → Ollama template → localhost:11434

3. Tune for small model
   /tune
   → Tool Profile: minimal (or nano for very small models)
   → Aggressive Compact: ON
   → Native Tool Calling: OFF (use XML fallback)
   → Temperature: 0.7
   → Max Tokens: 2048

   Or use preset: "Small Model" or "Nano (low-end hardware)"

4. (Optional) Per-provider auto-tune in agents.config.json
   {
     "providers": [{
       "name": "Ollama",
       "baseUrl": "http://localhost:11434/v1",
       "models": ["qwen2.5-coder:7b"],
       "tune": {
         "enabled": true,
         "toolProfile": "minimal",
         "aggressiveCompact": true
       }
     }]
   }

5. Code as normal
   → Context window managed by aggressive compact
   → Smaller system prompt leaves more room for your conversation
   → XML/JSON fallback handles models without native tool calling
```

### Profile Comparison

| Profile | Tools | System Prompt Tokens | Best For |
|---------|-------|---------------------|----------|
| full | All | ~500-700 | Modern cloud models |
| minimal | 8 core | ~500-700 (slim prompt) | 1B-8B local models |
| nano | 5 core | ~150-250 | Smallest models, low-end hardware |

---

## Multi-Provider Workflow

Use different providers for different tasks within the same project.

```
1. Configure multiple providers in agents.config.json
   {
     "providers": [
       {
         "name": "Ollama",
         "baseUrl": "http://localhost:11434/v1",
         "models": ["qwen2.5-coder:7b"],
         "tune": { "enabled": true, "toolProfile": "minimal" }
       },
       {
         "name": "OpenRouter",
         "baseUrl": "https://openrouter.ai/api/v1",
         "apiKey": "${OPENROUTER_API_KEY}",
         "models": ["anthropic/claude-sonnet-4"]
       }
     ]
   }

2. Switch providers during session
   /provider OpenRouter     → Use cloud model for complex task
   /provider Ollama         → Switch to local for simple exploration

3. Subagents with different providers
   # .nanocoder/agents/local-research.md
   ---
   name: local-research
   provider: ollama
   model: qwen2.5-coder:7b
   tools: [read_file, search_file_contents, find_files]
   ---
   Research the codebase and return findings.

4. Main agent delegates research to local model
   → Main conversation stays on cloud model
   → Subagent runs cheap research on local model
   → Only results returned to main context
```

---

## Skill Development Workflow

Create reusable extensions: commands, subagents, and custom tools.

### Single-File Command

```bash
# Create with AI assistance
/commands create review-code

# Edit the generated file
# .nanocoder/commands/review-code.md
```

```markdown
---
description: Review code for issues
aliases: [review]
parameters: [filename]
---

Review {{filename}} for bugs, security issues, and style problems.
Return findings with file paths and line numbers.
```

```bash
# Use it
/review-code src/auth/handler.ts
```

### Custom Tool

```bash
/tools create k8s-pods
```

```markdown
<!-- .nanocoder/tools/k8s-pods.md -->
---
name: k8s_pods
description: List pods in a Kubernetes namespace
parameters:
  namespace:
    type: string
    required: true
    pattern: '^[a-z0-9-]+$'
approval: never
read_only: true
---

kubectl get pods -n {{ namespace }}
```

### Bundle Skill (Multi-Piece)

```bash
# Scaffold
/skills create pr-reviewer

# Edit the bundle
# .nanocoder/skills/pr-reviewer/skill.yaml
```

```yaml
name: pr-reviewer
description: Automated PR review workflow
version: 1.0.0

tools_visibility:
  default: scoped   # tools only visible to this skill's agent
```

```
.nanocoder/skills/pr-reviewer/
  skill.yaml
  commands/review.md        → /pr-reviewer:review
  agents/reviewer.md        → subagent with scoped tools
  tools/
    gh_pr_diff.md           → custom tool (scoped)
```

---

## Daemon & Scheduled Task Workflow

Automate recurring tasks with the per-project daemon.

```
1. Create a skill with cron subscription

   # .nanocoder/commands/weekly-report.md
   ---
   description: Weekly status report
   subscribe:
     - kind: schedule.cron
       cron: "0 9 * * MON"
   ---

   Analyze git log for last week's commits.
   Summarize what changed, files modified, and contributors.

2. (Alternative) File watching

   # .nanocoder/agents/docs-watcher.md
   ---
   name: docs-watcher
   subscribe:
     - kind: file.changed
       paths: ["docs/**"]
       eventKinds: [add, change]
       confirm: true   # run in plan mode, not headless
   ---

   When docs change, check for broken links and stale references.

3. Start the daemon
   $ nanocoder daemon start

4. Verify
   $ nanocoder daemon status
   /schedule   → shows active cron subscriptions

5. View logs
   $ nanocoder daemon logs

6. (Optional) Auto-start across reboots
   $ nanocoder daemon install
```

---

## VS Code Integration Workflow

Bridge your editor with the CLI for a combined experience.

```
1. Start with VS Code flag
   $ nanocoder --vscode

   (Or from within a session: /ide → select VS Code)

2. Active editor context
   ┌──────────────────────────────────────────────────────┐
   │  VS Code: Open src/auth/handler.ts                   │
   │  → Status line shows: ⊡ In handler.ts               │
   │                                                      │
   │  Select lines 10-25                                  │
   │  → Status line shows: ⊡ handler.ts (L10-25)         │
   │  → Code auto-attached to next message                │
   └──────────────────────────────────────────────────────┘

3. Live diff preview
   AI proposes changes → VS Code opens diff view
   → Review left/right diff in editor
   → Approve or reject in CLI

4. Command palette
   Cmd+Shift+P → "Nanocoder: Start Nanocoder CLI"
```

---

## Session Management Workflow

Save, resume, and organize your conversations.

```
1. Auto-save (happens automatically)
   → Every 30 seconds (configurable)
   → Stored in platform app data directory

2. End of day
   /rename "Sprint 14 auth refactor"

3. Next day — resume
   /resume           → interactive selector
   /resume last      → jump to most recent

4. Export for sharing
   /export           → saves to markdown file

5. Session rotation
   /clear            → start fresh (auto-saves old session)
   /resume           → old session still available

6. Configure retention
   {
     "nanocoder": {
       "sessions": {
         "maxSessions": 100,
         "retentionDays": 30,
         "maxMessages": 1000
       }
     }
   }
```

---

## Context Management Workflow

Keep long conversations productive by managing the context window.

```
1. Monitor usage
   /usage            → visual context breakdown
   /status           → context usage + provider info

2. Manual compression
   /compact                    → LLM summary (default)
   /compact --preview          → see what would compress
   /compact --mechanical       → regex-based (no API cost)
   /compact --aggressive       → maximum savings

3. Auto-compact (configure once)
   {
     "nanocoder": {
       "autoCompact": {
         "enabled": true,
         "threshold": 60,        // compress at 60% usage
         "strategy": "llm",
         "notifyUser": true
       }
     }
   }

4. Session overrides (temporary)
   /compact --auto-off          → disable for this session
   /compact --threshold 80      → change trigger point
   /compact --strategy mechanical → switch strategy

5. Restore if compression lost important context
   /compact --restore           → undo last compression
```

---

## Checkpoint Experimentation Workflow

Safe experimentation with rollback capability.

```
1. Save state before risky change
   /checkpoint create before-refactor

2. Try experimental approach
   "Refactor the data layer to use repositories instead of direct DB calls"

3a. If it went well
   /checkpoint create after-refactor
   Continue working...

3b. If it didn't work
   /checkpoint load before-refactor
   → Files restored
   → Try a different approach

4. Review checkpoints
   /checkpoint list

5. Clean up
   /checkpoint delete before-refactor
```

---

## Project Onboarding Workflow

Get the AI up to speed on a new project.

```
1. Navigate to project
   $ cd /path/to/new-project

2. Generate project context
   /init
   → Scans files, detects frameworks/languages
   → Generates AGENTS.md with:
     • Project overview and type
     • Architecture description
     • Key files and directories
     • Build/test/lint commands
     • Code style guidelines

   /init --force    → regenerate (overwrite existing)
   /init --lean     → skip CLAUDE.md merge

3. AGENTS.md is auto-loaded every session
   → AI knows your project structure
   → AI knows your conventions
   → AI knows how to build and test

4. (Optional) Create project-specific commands
   /commands create deploy
   /commands create test-changed

5. (Optional) Create project-specific agents
   /agents create code-reviewer
   → Tailored to your codebase conventions
```

---

## Code Review Workflow

Leverage subagents and tools for thorough code review.

```
1. Using the built-in explore subagent
   "Review the changes in src/auth/ for security issues"

   → Main agent delegates to explore subagent
   → Subagent reads files, searches for patterns
   → Returns findings to main context

2. Custom review agent
   # Create with /agents create security-reviewer

   ---
   name: security-reviewer
   description: Security-focused code review
   tools:
     - read_file
     - search_file_contents
     - find_files
     - git_diff
   ---

   You are a security specialist. Review code for:
   - SQL injection, XSS, CSRF vulnerabilities
   - Authentication/authorization issues
   - Sensitive data exposure
   - Insecure dependencies

3. Combine with plan mode
   Shift+Tab → plan mode
   "Analyze the auth module and list all security concerns"
   → Read-only exploration
   → Structured security report
   → No changes made

4. Review with git context
   !git diff main..feature-branch
   "Review these changes for bugs and style issues"
```

---

## Multi-Agent Research Workflow

Use parallel subagents for comprehensive research.

```
1. Ask the main agent to research multiple areas
   "Research the following in parallel:
    1. How does the authentication flow work?
    2. What database queries are used in the user module?
    3. What third-party APIs does the payment module call?"

2. Main agent spawns up to 5 parallel subagents
   → Each subagent explores independently
   → Each has its own context window
   → Results aggregated back to main conversation

3. Use custom subagents for specialized research
   /agents create db-analyst
   /agents create api-mapper
   /agents create dependency-tracker

4. Subagent with different provider
   ---
   name: cheap-researcher
   provider: ollama
   model: qwen2.5-coder:3b
   ---
   Search and summarize. Be concise.
```

---

## Key Architectural Patterns

### State Flow

```
useAppState (single source of truth)
    ↓ state + setters passed to:
    ├── useChatHandler    → manages LLM conversation
    ├── useToolHandler    → processes tool calls
    ├── useModeHandlers   → mode switching
    ├── useAppHandlers    → general app events
    └── useSessionAutosave → periodic session persistence
```

### Tool Execution Pipeline

```
LLM Response (contains tool call)
    ↓
Chat Handler detects tool call
    ↓
Tool Handler checks:
    ├── Is tool in disabledTools? → reject
    ├── Is tool in alwaysAllow? → execute immediately
    ├── Is mode yolo? → execute immediately
    ├── Is mode auto-accept + non-destructive? → execute
    ├── Is mode normal? → prompt user
    └── Is mode plan + mutation tool? → reject
    ↓
Execute tool (built-in / MCP / custom)
    ↓
Result returned to conversation
    ↓
LLM continues with result
```

### Provider Resolution

```
CLI --provider flag
    ↓ (highest)
agents.config.json providers[]
    ↓
NANOCODER_PROVIDERS env var
    ↓
Preferences (last used)
    ↓
First provider in config
```

---

*This document was generated from source code analysis of the Nanocoder repository.*
