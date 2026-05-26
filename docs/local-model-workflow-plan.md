# Optimized Local Model Workflow — Implementation Plan

> **Goal:** Incorporate LocalClaw's proven techniques for making local models (7B–30B) effective in a coding agent, into Nanocoder's architecture. Every idea below is derived from the LocalClaw codebase at `/Users/deniz.okcu/development/LocalClaw`.

---

## Table of Contents

- [Problem Statement](#problem-statement)
- [Summary of LocalClaw Ideas](#summary-of-localclaw-ideas)
- [Implementation Plan](#implementation-plan)
  - [Phase 1: Router + Specialist Architecture](#phase-1-router--specialist-architecture)
  - [Phase 2: Deterministic Pipeline Engine](#phase-2-deterministic-pipeline-engine)
  - [Phase 3: Context Budget Management](#phase-3-context-budget-management)
  - [Phase 4: Structured Parameter Extraction](#phase-4-structured-parameter-extraction)
  - [Phase 5: Self-Improving Skills System](#phase-5-self-improving-skills-system)
  - [Phase 6: Error Learning & Recovery](#phase-6-error-learning--recovery)
  - [Phase 7: Proactive Context Compaction](#phase-7-proactive-context-compaction)
  - [Phase 8: Smart Model Routing](#phase-8-smart-model-routing)
  - [Phase 9: Multi-Model Strategy](#phase-9-multi-model-strategy)
  - [Phase 10: Tool Observation Summarization](#phase-10-tool-observation-summarization)
  - [Phase 11: Hallucination & Drift Detection](#phase-11-hallucination--drift-detection)
- [Implementation Order & Dependencies](#implementation-order--dependencies)
- [Configuration Reference](#configuration-reference)
- [Testing Strategy](#testing-strategy)

---

## Problem Statement

Local models (7B–30B parameters on Ollama, llama.cpp, etc.) have fundamental limitations when used in agentic coding workflows:

| Problem | Manifestation |
|---------|---------------|
| **Narrating instead of executing** | Model says "I would search for..." instead of calling the tool |
| **Tool hallucination** | When given 15+ tools, model invents non-existent tool names |
| **Token burning** | Internal reasoning consumes all `max_tokens`, producing empty responses |
| **JSON parsing failures** | Complex schemas produce malformed output |
| **Poor tool sequencing** | Model answers before using tools, wanders to irrelevant actions |
| **Context window pressure** | System prompt + tools + history overflow small context windows |
| **No self-correction** | Model repeats the same failing approach |

Nanocoder already has partial mitigations (XML/JSON tool-call fallbacks, minimal/nano tool profiles, aggressive compaction). LocalClaw solves these problems architecturally — the plan below brings those architectural solutions into Nanocoder.

---

## Summary of LocalClaw Ideas

| # | Idea | LocalClaw Source | Nanocoder Gap |
|---|------|-----------------|---------------|
| 1 | **Router + Specialist** — small model classifies intent, specialist sees only relevant tools | `src/router/classifier.ts`, `src/dispatch.ts` | Nanocoder gives the model all tools; no intent routing |
| 2 | **Deterministic pipelines** — code controls workflow, model only extracts/synthesizes | `src/pipeline/executor.ts`, `src/pipeline/types.ts` | Nanocoder relies on the model to decide every step |
| 3 | **Context budget calculator** — precise token accounting before each request | `src/context/budget.ts` | Nanocoder has rough estimation but no explicit budgeting |
| 4 | **Structured parameter extraction** — focused LLM call returns JSON params only | `src/pipeline/extractor.ts` | Nanocoder passes raw user message to the model |
| 5 | **Self-improving skills** — successful plan executions saved and reused | `src/skills/store.ts`, `src/skills/matcher.ts` | Nanocoder has custom commands but no learned skills |
| 6 | **Error learning store** — tool failures recorded and used as hints | `src/learnings/error-store.ts`, `src/learnings/pattern-matcher.ts` | Nanocoder has no error memory across sessions |
| 7 | **Proactive compaction at 50%** — compress before crisis | `src/context/compactor.ts` | Nanocoder compacts at 60% threshold (close, but no structured summary) |
| 8 | **Smart model routing** — simple messages use faster/smaller model | `src/dispatch.ts:shouldUseQuickModel()` | Nanocoder has no model switching based on message complexity |
| 9 | **Multi-model strategy** — different models for router, specialist, chat, reasoning | `localclaw.config.json5.example` | Nanocoder's tune system has profiles but no automatic model selection |
| 10 | **Tool observation summarization** — LLM summarizes old tool results instead of truncating | `src/tool-loop/engine.ts:trimToolLoopMessages()` | Nanocoder truncates or mechanically compresses tool output |
| 11 | **Hallucination & drift detection** — detect narrated tool calls, repeating patterns, hedging | `src/tool-loop/engine.ts` | Nanocoder has XML/JSON fallback parsing but no drift detection |
| 12 | **Frozen workspace snapshots** — workspace context loaded once per session | `src/dispatch.ts:workspaceCache` | Nanocoder re-reads AGENTS.md every turn |
| 13 | **Thinking token headroom** — `num_predict` large enough for thinking models | DECISIONS.md | Nanocoder's `max_tokens` may starve thinking models |
| 14 | **Source attribution in context** — tag context sections with origin labels | ROADMAP.md §2.4 | Nanocoder injects context without origin labels |
| 15 | **Tool-specific error recovery** — recovery instructions mapped to (tool, errorType) | `src/learnings/pattern-matcher.ts:TOOL_RECOVERY_MAP` | Nanocoder shows generic errors |

---

## Implementation Plan

---

### Phase 1: Router + Specialist Architecture

**LocalClaw reference:** `src/router/classifier.ts`, `src/dispatch.ts`
**Nanocoder files to modify/create:** `source/hooks/chat-handler/`, `source/client-factory.ts`, new `source/router/`

#### 1.1 Intent Router

Create a lightweight intent classifier that runs before the main chat handler. When a local provider is active, route the user's message through a small fast model to classify intent into categories:

| Category | Tool Set | Description |
|----------|----------|-------------|
| `code_edit` | `read_file`, `write_file`, `string_replace`, `find_files`, `search_file_contents` | File editing and code generation |
| `code_explore` | `read_file`, `find_files`, `search_file_contents`, `list_directory` | Code exploration and understanding |
| `shell` | `execute_bash` | Running commands |
| `git` | `git_status`, `git_diff`, `git_log`, `git_add`, `git_commit`, `git_push`, `git_pull`, `git_branch` | Git operations |
| `web` | `web_search`, `fetch_url` | Web search and fetching |
| `task` | `create_task`, `list_tasks`, `update_task`, `delete_task` | Task management |
| `chat` | (none) | General conversation, no tools needed |

**Implementation:**

```
source/router/
  classifier.ts       — 3-tier classification: pre-model overrides → model → keyword fallback
  prompt.ts           — Router prompt builder
  types.ts            — Category, ClassifyResult types
  keyword-hints.ts    — Keyword pattern table for fallback classification
```

**3-tier fallback (from LocalClaw):**

1. **Pre-model overrides** — High-confidence regex patterns (e.g., `!command` → shell, `@file` → code_edit, `/git*` → git)
2. **Model classification** — Small model (configurable, e.g., `phi4:14b`) classifies in ~50ms with `temperature: 0.1, max_tokens: 20`
3. **Keyword heuristics** — Pattern matching when model fails/times out
4. **Default fallback** → `chat`

**Sticky routing (from LocalClaw):**
- Follow-up messages in the same session stay on the same category
- Strong new-topic signals break sticky (e.g., "search for", "run", "commit")
- Only conversation-oriented categories (`chat`, `code_explore`) are sticky

#### 1.2 Specialist Dispatch

After classification, dispatch to a specialist with a filtered tool set:

```typescript
// New config in agents.config.json
{
  "nanocoder": {
    "localModelWorkflow": {
      "enabled": true,
      "routerModel": "phi4:14b",
      "categories": {
        "code_edit": {
          "tools": ["read_file", "write_file", "string_replace", "find_files", "search_file_contents"],
          "maxIterations": 8
        },
        "code_explore": {
          "tools": ["read_file", "find_files", "search_file_contents", "list_directory"],
          "maxIterations": 5
        },
        // ...
      }
    }
  }
}
```

**Key principle from LocalClaw:** Each specialist sees 1–5 tools, never all 30+. Even a 7B model handles 3 tools reliably.

#### 1.3 Integration Point

The router activates only when:
- A local provider is active (Ollama, llama.cpp, LM Studio, etc.), OR
- `localModelWorkflow.enabled` is explicitly set to `true`

For cloud providers, the existing tool-calling path is used unchanged.

**Tasks:**
- [ ] Create `source/router/classifier.ts` with 3-tier classification
- [ ] Create `source/router/prompt.ts` with few-shot router prompt
- [ ] Create `source/router/keyword-hints.ts` with keyword pattern table
- [ ] Create `source/router/types.ts`
- [ ] Modify `source/hooks/chat-handler/` to call router before dispatch
- [ ] Add `localModelWorkflow` config schema to `source/config/validation.ts`
- [ ] Add category → tool-set mapping logic
- [ ] Add sticky routing with new-topic detection
- [ ] Write tests: `source/router/classifier.spec.ts`

---

### Phase 2: Deterministic Pipeline Engine

**LocalClaw reference:** `src/pipeline/executor.ts`, `src/pipeline/types.ts`, `src/pipeline/definitions/`
**Nanocoder files to create:** `source/pipeline/`

#### 2.1 Pipeline Type System

Define stage types that control the workflow in code, not by model decision:

```typescript
// source/pipeline/types.ts

type PipelineStage =
  | { type: 'extract'; schema: Record<string, FieldSchema>; examples?: Example[] }
  | { type: 'tool'; tool: string; resolveParams: (ctx) => Record<string, unknown> }
  | { type: 'llm'; buildPrompt: (ctx) => { system: string; user: string }; maxTokens?: number }
  | { type: 'code'; execute: (ctx) => unknown }
  | { type: 'branch'; decide: (ctx) => string; branches: Record<string, PipelineStage[]> }
  | { type: 'llm_branch'; prompt: string; options: string[]; fallback: string; branches: Record<string, PipelineStage[]> }
  | { type: 'loop'; maxIterations: number; stages: PipelineStage[]; continueIf: (ctx, i) => boolean }
  | { type: 'parallel_tool'; tool: string; resolveParamsList: (ctx) => Record<string, unknown>[] }
  | { type: 'when'; condition: (ctx) => boolean; stage: PipelineStage }
```

#### 2.2 Pipeline Executor

Sequential stage runner that passes a shared `PipelineContext` between stages:

```typescript
// source/pipeline/executor.ts

interface PipelineContext {
  userMessage: string;
  params: Record<string, unknown>;
  stageResults: Record<string, unknown>;
  steps: Array<{ tool?: string; params?: Record<string, unknown>; observation?: string }>;
  client: LLMClient;
  toolRegistry: ToolRegistry;
  // ...
}

async function runPipeline(definition: PipelineDefinition, ctx: PipelineContext): Promise<PipelineResult>
```

#### 2.3 Built-in Pipelines

Define pipelines for common coding tasks that local models handle poorly in open-ended ReAct loops:

| Pipeline | Stages | Purpose |
|----------|--------|---------|
| `code_search` | extract(query) → tool(find_files) → tool(search_file_contents) → llm(synthesize) | "Where is X implemented?" |
| `code_edit` | extract(file, change) → tool(read_file) → tool(string_replace) → llm(review) | "Change X in file Y" |
| `git_workflow` | extract(action) → branch → tool(git_status) / tool(git_add+commit) | "Commit my changes" |
| `debug_error` | extract(error) → tool(search_file_contents) → tool(read_file) → llm(analyze) | "Fix this error" |

**Key principle from LocalClaw:** "Code handles the 'what' (which steps, which tools). Model handles the 'so what' (extract params, synthesize text)."

**Tasks:**
- [ ] Create `source/pipeline/types.ts` with stage type definitions
- [ ] Create `source/pipeline/executor.ts` with stage runner
- [ ] Create `source/pipeline/registry.ts` for pipeline registration
- [ ] Create `source/pipeline/extractor.ts` for structured parameter extraction
- [ ] Create `source/pipeline/definitions/` directory with built-in pipelines
- [ ] Integrate with router: category → pipeline lookup
- [ ] Write tests: `source/pipeline/executor.spec.ts`

---

### Phase 3: Context Budget Management

**LocalClaw reference:** `src/context/budget.ts`, `src/context/tokens.ts`
**Nanocoder files to modify:** `source/hooks/useContextPercentage.ts`, new `source/context/`

#### 3.1 Precise Token Budget Calculator

Before each LLM call, compute exact allocation:

```typescript
// source/context/budget.ts

interface ContextBudget {
  totalTokens: number;       // model context window
  systemPromptTokens: number; // system prompt + AGENTS.md + tool definitions
  toolResultTokens: number;   // pending tool results
  historyTokens: number;     // conversation history
  outputReserve: number;     // max_tokens for response
  availableForHistory: number; // totalTokens - system - tools - outputReserve
}
```

#### 3.2 Token Estimation

Nanocoder already has token estimation. Enhance with LocalClaw's word-aware heuristic that's calibrated for BPE tokenizers (overestimates by ~10-15%, which is safer than underestimating).

#### 3.3 Priority Layers (from LocalClaw ROADMAP §2.1)

When budget is tight, shrink sections in priority order:
1. **Tool results** — most important, keep verbatim
2. **Recent history** — last 2–4 turns, keep verbatim
3. **Workspace context** — AGENTS.md, shrink or omit
4. **Old history** — compress or summarize

**Tasks:**
- [ ] Create `source/context/budget.ts` with budget calculator
- [ ] Enhance `source/tokenization/` with BPE-calibrated estimation
- [ ] Modify chat handler to check budget before each LLM call
- [ ] Add budget-aware context trimming in priority order
- [ ] Write tests: `source/context/budget.spec.ts`

---

### Phase 4: Structured Parameter Extraction

**LocalClaw reference:** `src/pipeline/extractor.ts`
**Nanocoder files to create:** `source/pipeline/extractor.ts`

#### 4.1 Focused Extraction Calls

Instead of giving the model the user's message and all tools simultaneously, make a focused extraction call:

```typescript
// source/pipeline/extractor.ts

async function extractParams(
  client: LLMClient,
  model: string,
  schema: Record<string, FieldSchema>,
  userMessage: string,
  examples?: Array<{ input: string; output: Record<string, unknown> }>,
): Promise<Record<string, unknown>>
```

The extraction prompt:
- Lists only the parameters needed (e.g., `filename`, `search_query`, `changes`)
- Returns ONLY JSON — no explanation, no markdown
- Uses `temperature: 0.1` for deterministic output
- Has a JSON repair retry: if parsing fails, send the malformed output back with "That was not valid JSON. Return ONLY a JSON object."

#### 4.2 Example

User says: "Change the auth middleware in src/middleware.ts to use JWT instead of sessions"

Extraction call returns:
```json
{
  "file": "src/middleware.ts",
  "pattern": "auth middleware",
  "change": "Replace session-based auth with JWT"
}
```

Pipeline then calls `read_file`, `string_replace`, etc. with these extracted params.

**Tasks:**
- [ ] Create `source/pipeline/extractor.ts` with schema-driven extraction
- [ ] Add JSON repair retry logic
- [ ] Add few-shot examples for common extraction patterns
- [ ] Write tests: `source/pipeline/extractor.spec.ts`

---

### Phase 5: Self-Improving Skills System

**LocalClaw reference:** `src/skills/store.ts`, `src/skills/matcher.ts`
**Nanocoder files to modify:** `source/skills/`, new `source/skills/learned-skills/`

#### 5.1 Learned Skill Store

Extend Nanocoder's existing skill system with a **learned skills** store that records successful multi-step executions:

```typescript
// source/skills/learned-store.ts

interface LearnedSkill {
  name: string;
  slug: string;
  description: string;
  created: string;
  lastUsed: string;
  successCount: number;
  steps: Array<{ tool: string; params: Record<string, unknown>; purpose: string }>;
  notes: string[];  // lessons learned from execution
}
```

#### 5.2 Skill Matching

Before planning a new task, search for matching skills:

```typescript
// source/skills/learned-matcher.ts

function findMatchingSkill(
  store: LearnedSkillStore,
  goal: string,
  threshold = 8,
): LearnedSkill | null
```

Scoring (from LocalClaw):
- Keyword match in name: +3
- Keyword match in description: +2
- Success count bonus: +1 per 5 successes (max +2)
- Minimum score threshold: 8
- At least 30% of goal keywords must match

#### 5.3 Skill Saving

After a successful multi-step task (>3 tool calls, >60% step success rate):
1. Save the tool execution sequence as a skill
2. Record lessons learned (which steps failed, what worked)
3. Next time a similar task comes in, load the skill instead of planning from scratch

#### 5.4 Progressive Disclosure (from LocalClaw)

Three tiers to save tokens:
1. **List** — name + description only (~20 tokens per skill)
2. **Full load** — steps and notes (~200 tokens)
3. **Referenced files** — individual file contents on demand

**Tasks:**
- [ ] Create `source/skills/learned-store.ts` with markdown-based persistence
- [ ] Create `source/skills/learned-matcher.ts` with keyword scoring
- [ ] Integrate with plan mode: check skills before planning
- [ ] Add skill save after successful task completion
- [ ] Add progressive disclosure for skill context injection
- [ ] Write tests: `source/skills/learned-matcher.spec.ts`, `source/skills/learned-store.spec.ts`

---

### Phase 6: Error Learning & Recovery

**LocalClaw reference:** `src/learnings/error-store.ts`, `src/learnings/pattern-matcher.ts`
**Nanocoder files to create:** `source/learnings/`

#### 6.1 Error Learning Store

Record tool failures in a persistent JSONL file:

```typescript
// source/learnings/error-store.ts

interface ErrorEntry {
  tool: string;
  params: Record<string, unknown>;
  error: string;
  errorType: string;  // permission_denied, module_not_found, timeout, http_error, etc.
  timestamp: string;
  stepNumber: number;
}
```

Before executing a tool, check for past errors with matching tool + params and prepend recovery hints.

#### 6.2 Tool-Specific Recovery Map

Map `(toolName, errorType)` → actionable recovery instructions:

```typescript
// source/learnings/recovery-map.ts

const TOOL_RECOVERY_MAP: Record<string, Record<string, string>> = {
  execute_bash: {
    permission_denied: 'Check file permissions. Try with a different approach or check the file exists.',
    module_not_found: 'Module not found. Install it first: npm install <pkg> or pip install <pkg>.',
    timeout: 'Command timed out. Try a shorter-running command or break the task into smaller steps.',
  },
  read_file: {
    http_error: 'File not found. Use find_files to locate the correct path.',
  },
  web_search: {
    rate_limit: 'Search API rate limited. Wait before retrying or simplify the query.',
    timeout: 'Search timed out. Retry with a shorter query.',
  },
  // ... for all tools
};
```

#### 6.3 Error Pattern Detection

After each tool execution, scan the observation for known patterns:
- `permission denied` / `EACCES`
- `module not found`
- `connection refused` / `ECONNREFUSED`
- `timeout` / `ETIMEDOUT`
- HTTP 404/403
- Rate limiting (429)
- Stack traces
- Out of memory

When detected, enrich the observation with tool-specific recovery guidance.

#### 6.4 Learning Promotion

On session end (or periodically), scan for recurring patterns (3+ occurrences of same tool + error). Promote these to a `.nanocoder/LEARNINGS.md` file that's loaded into the system prompt.

**Tasks:**
- [ ] Create `source/learnings/error-store.ts` with JSONL persistence
- [ ] Create `source/learnings/recovery-map.ts` with tool-specific guidance
- [ ] Create `source/learnings/pattern-matcher.ts` with error pattern detection
- [ ] Integrate with tool handler: check errors before execution, enrich observations after
- [ ] Add learning promotion to session end hook
- [ ] Write tests: `source/learnings/error-store.spec.ts`, `source/learnings/pattern-matcher.spec.ts`

---

### Phase 7: Proactive Context Compaction

**LocalClaw reference:** `src/context/compactor.ts`
**Nanocoder files to modify:** `source/hooks/chat-handler/`, `source/commands/compact.ts`

#### 7.1 Structured Compaction Summary

Instead of Nanocoder's current LLM summary (which is already good), add LocalClaw's structured template:

```
## Session Summary

### Goal
[What the user is working on]

### Progress
[What has been accomplished]

### Decisions Made
[Key choices that should not be revisited]

### Files Modified
[Each file touched and what changed]

### Open Questions
[Unresolved items]
```

#### 7.2 Proactive Threshold at 50%

Compact at 50% of context budget (Nanocoder defaults to 60%). This gives the model room to work after compaction instead of being immediately squeezed again.

#### 7.3 Tool-Pair Sanitization

After compaction, sanitize orphaned tool_call/result pairs:
- If a tool result exists without a preceding tool call, remove it
- If a tool call exists without a result, add a synthetic "result was compacted" message

#### 7.4 Memory Flush Before Compaction

Before compacting the archive zone, extract key facts and append to a session notes file. This preserves information that the summary might miss.

**Tasks:**
- [ ] Modify `/compact` to use structured Goal/Progress/Decisions template
- [ ] Change default auto-compact threshold to 50% for local models
- [ ] Add tool-pair sanitization after compaction
- [ ] Add memory flush before compaction
- [ ] Write tests for new compaction behavior

---

### Phase 8: Smart Model Routing

**LocalClaw reference:** `src/dispatch.ts:shouldUseQuickModel()`
**Nanocoder files to modify:** `source/hooks/chat-handler/`, `source/config/tune.ts`

#### 8.1 Message Complexity Detection

Before each LLM call, assess message complexity:

```typescript
// source/router/complexity.ts

interface MessageComplexity {
  isSimple: boolean;
  reason?: string;
}

function assessComplexity(message: string, hasCodeBlocks: boolean): MessageComplexity {
  // Long messages need the full model
  if (message.length > 160) return { isSimple: false, reason: 'long_message' };
  // Code blocks need the full model
  if (hasCodeBlocks) return { isSimple: false, reason: 'code_blocks' };
  // Complex task keywords need the full model
  if (/\b(search|find|refactor|debug|fix|implement|create|build|write)\b/i.test(message)) {
    return { isSimple: false, reason: 'task_intent' };
  }
  // Short conversational message — can use a smaller/faster model
  return { isSimple: true };
}
```

#### 8.2 Dual-Model Configuration

When using a local provider, configure a fast model for simple messages:

```json
{
  "nanocoder": {
    "localModelWorkflow": {
      "fastModel": "qwen2.5:3b",
      "fullModel": "qwen2.5-coder:7b"
    }
  }
}
```

Simple messages (greetings, "thanks", short questions) route to `fastModel`.
Complex tasks route to `fullModel`.

**Tasks:**
- [ ] Create `source/router/complexity.ts` with message assessment
- [ ] Modify chat handler to switch models based on complexity
- [ ] Add `fastModel` config to local model workflow settings
- [ ] Write tests: `source/router/complexity.spec.ts`

---

### Phase 9: Multi-Model Strategy

**LocalClaw reference:** `localclaw.config.json5.example` — different models for different roles
**Nanocoder files to modify:** `source/config/`, `source/client-factory.ts`, `source/subagents/`

#### 9.1 Role-Based Model Assignment

Allow per-role model configuration:

```json
{
  "nanocoder": {
    "localModelWorkflow": {
      "models": {
        "router": "phi4:14b",
        "chat": "gemma4:26b",
        "code_edit": "qwen3-coder:30b",
        "code_explore": "qwen3-coder:30b",
        "reasoning": "nemotron-3-nano:30b"
      }
    }
  }
}
```

#### 9.2 Reasoning Handoff

Add a `reason` tool (like LocalClaw) that hands off to a dedicated reasoning model for:
- Deep analysis before code changes
- Complex debugging
- Architecture decisions

The reasoning model never calls tools — it only thinks and returns text.

#### 9.3 Subagent Model Separation

LocalClaw uses different models for different subagent tasks. Apply this to Nanocoder's existing subagent system:
- `explore` subagent: can use a smaller, faster model
- Custom subagents: can specify `provider` and `model` (already supported)
- Add a built-in `reason` subagent that uses the reasoning model

**Tasks:**
- [ ] Add role-based model config to `localModelWorkflow`
- [ ] Create `source/tools/reason-tool.tsx` for reasoning handoff
- [ ] Add built-in `reason` subagent
- [ ] Modify subagent executor to respect per-role model config
- [ ] Write tests

---

### Phase 10: Tool Observation Summarization

**LocalClaw reference:** `src/tool-loop/engine.ts:trimToolLoopMessages()` with optional LLM summarizer
**Nanocoder files to modify:** `source/hooks/useToolHandler.tsx`, `source/commands/compact.ts`

#### 10.1 LLM-Based Observation Summarization

Instead of hard-truncating old tool observations to 300 characters, use a fast model to summarize:

```typescript
// source/context/observation-summarizer.ts

async function summarizeObservation(
  observation: string,
  toolName: string,
  client: LLMClient,
  model: string,  // use router model (fast)
): Promise<string | null> {
  // Only summarize observations > 1000 chars
  if (observation.length <= 1000) return null;

  const summary = await client.chat({
    model,
    messages: [
      { role: 'system', content: `Summarize this ${toolName} result. Preserve: file paths, error messages, key values, status codes. Remove: verbose output, repeated content.` },
      { role: 'user', content: observation.slice(0, 4000) },
    ],
    options: { temperature: 0.1, max_tokens: 300 },
  });

  return summary;
}
```

#### 10.2 Tiered Trimming Strategy

| Observation Size | Action |
|-----------------|--------|
| < 300 chars | Keep as-is |
| 300–1000 chars | Hard-truncate to 300 chars |
| > 1000 chars | LLM summarize (fallback: hard-truncate) |

#### 10.3 Configuration

```json
{
  "nanocoder": {
    "localModelWorkflow": {
      "summarizeToolObservations": true,
      "summarizationModel": "phi4:14b"
    }
  }
}
```

**Tasks:**
- [ ] Create `source/context/observation-summarizer.ts`
- [ ] Modify tool handler to use summarizer for old observations
- [ ] Add config toggle for observation summarization
- [ ] Write tests: `source/context/observation-summarizer.spec.ts`

---

### Phase 11: Hallucination & Drift Detection

**LocalClaw reference:** `src/tool-loop/engine.ts` — context drift detection, hallucination detector
**Nanocoder files to create:** `source/context/drift-detector.ts`

#### 11.1 Context Drift Detection

Monitor for three drift signals during tool-calling loops:

1. **Repeating tool calls** — same tool + same params called twice
2. **Hedging language** — 4+ instances of "I think", "perhaps", "maybe" in a single response
3. **Growing responses without progress** — response getting longer but no tool calls being made

When drift is detected, inject a re-anchor prompt:

```
⚠️ Drift detected. Re-read the original user request and provide a direct answer.
Original request: "{user_message}"
```

#### 11.2 Verb-Aware Hallucination Detection

After the model summarizes its actions, verify claimed action verbs against actual tool calls:

```typescript
const TOOL_ACTION_VERBS: Record<string, string[]> = {
  web_search: ['searched', 'found', 'looked up'],
  read_file: ['read', 'opened', 'examined'],
  write_file: ['wrote', 'created', 'saved'],
  string_replace: ['modified', 'changed', 'updated', 'replaced'],
  execute_bash: ['ran', 'executed', 'compiled'],
};
```

If the model claims "I searched the web" but `web_search` was never called, flag it. But if `web_search` WAS called and the model is summarizing, that's legitimate.

#### 11.3 Thinking Token Headroom

From LocalClaw's DECISIONS.md: thinking models (qwen3, nemotron) use internal reasoning tokens before producing output. If `max_tokens` is too low (e.g., 1024), the model spends all tokens thinking and produces nothing.

**Mitigation:**
- Detect thinking models (models with `/thinking/` in their name or configured as thinking)
- Automatically increase `max_tokens` for thinking models (minimum 4096, recommended 8192)
- Add a warning when tune `max_tokens` is set below 4096 for known thinking models

**Tasks:**
- [ ] Create `source/context/drift-detector.ts` with repeat/hedge/growth detection
- [ ] Add verb-aware hallucination check after model response
- [ ] Add thinking model detection and automatic max_tokens adjustment
- [ ] Integrate drift detection into the tool-calling loop
- [ ] Write tests: `source/context/drift-detector.spec.ts`

---

## Implementation Order & Dependencies

```
Phase 1: Router + Specialist (foundational — everything else depends on this)
    ↓
Phase 3: Context Budget Management (needed before pipelines can be smart about tokens)
    ↓
Phase 4: Structured Parameter Extraction (needed by pipelines)
    ↓
Phase 2: Deterministic Pipeline Engine (uses router + budget + extractor)
    ↓
Phase 7: Proactive Context Compaction (improves on existing, independent of pipelines)
    ↓
Phase 6: Error Learning & Recovery (independent, high value)
    ↓
Phase 8: Smart Model Routing (builds on router from Phase 1)
    ↓
Phase 9: Multi-Model Strategy (builds on smart routing)
    ↓
Phase 10: Tool Observation Summarization (builds on budget from Phase 3)
    ↓
Phase 5: Self-Improving Skills (builds on pipelines from Phase 2)
    ↓
Phase 11: Hallucination & Drift Detection (polish layer, independent)
```

### Priority Matrix

| Phase | Impact | Effort | Priority |
|-------|--------|--------|----------|
| Phase 1: Router + Specialist | **Critical** — solves tool hallucination | High | 🔴 P0 |
| Phase 3: Context Budget | **High** — prevents context overflow | Medium | 🔴 P0 |
| Phase 4: Parameter Extraction | **High** — reliable param passing | Medium | 🟡 P1 |
| Phase 7: Proactive Compaction | **Medium** — improves existing feature | Low | 🟡 P1 |
| Phase 6: Error Learning | **Medium** — self-correction | Medium | 🟡 P1 |
| Phase 2: Pipeline Engine | **High** — but depends on P0 phases | High | 🟢 P2 |
| Phase 8: Smart Model Routing | **Medium** — latency improvement | Low | 🟢 P2 |
| Phase 11: Drift Detection | **Medium** — quality improvement | Low | 🟢 P2 |
| Phase 10: Observation Summarization | **Low** — incremental improvement | Medium | 🔵 P3 |
| Phase 9: Multi-Model Strategy | **Medium** — but requires multiple models | Medium | 🔵 P3 |
| Phase 5: Self-Improving Skills | **Medium** — requires pipeline engine | High | 🔵 P3 |

---

## Configuration Reference

### Full Local Model Workflow Config

```json
{
  "nanocoder": {
    "localModelWorkflow": {
      "enabled": true,
      "activateForLocalProviders": true,

      "router": {
        "model": "phi4:14b",
        "timeout": 2000,
        "defaultCategory": "chat"
      },

      "categories": {
        "code_edit": {
          "tools": ["read_file", "write_file", "string_replace", "find_files", "search_file_contents", "agent"],
          "maxIterations": 8,
          "pipeline": "code_edit"
        },
        "code_explore": {
          "tools": ["read_file", "find_files", "search_file_contents", "list_directory", "agent"],
          "maxIterations": 5,
          "pipeline": "code_search"
        },
        "shell": {
          "tools": ["execute_bash"],
          "maxIterations": 3
        },
        "git": {
          "tools": ["git_status", "git_diff", "git_log", "git_add", "git_commit", "git_push", "git_pull", "git_branch"],
          "maxIterations": 5,
          "pipeline": "git_workflow"
        },
        "web": {
          "tools": ["web_search", "fetch_url"],
          "maxIterations": 5
        },
        "task": {
          "tools": ["create_task", "list_tasks", "update_task", "delete_task"],
          "maxIterations": 3,
          "pipeline": "task"
        },
        "chat": {
          "tools": [],
          "maxIterations": 1
        }
      },

      "models": {
        "router": "phi4:14b",
        "fast": "qwen2.5:3b",
        "chat": "gemma4:26b",
        "code_edit": "qwen3-coder:30b",
        "reasoning": "nemotron-3-nano:30b"
      },

      "compaction": {
        "proactiveThreshold": 0.5,
        "structuredSummary": true,
        "memoryFlushBeforeCompact": true,
        "toolPairSanitization": true
      },

      "errorLearning": {
        "enabled": true,
        "store": ".nanocoder/learnings/errors.jsonl",
        "promoteThreshold": 3,
        "recoveryMap": true
      },

      "summarizeToolObservations": true,
      "summarizationModel": "phi4:14b",

      "driftDetection": {
        "enabled": true,
        "maxRepeats": 2,
        "hedgingThreshold": 4
      },

      "thinkingModelHeadroom": {
        "enabled": true,
        "minMaxTokens": 4096,
        "recommendedMaxTokens": 8192
      }
    }
  }
}
```

---

## Testing Strategy

### Unit Tests (per phase)

Each phase should include comprehensive unit tests:

| Phase | Test File | Key Test Cases |
|-------|-----------|---------------|
| Phase 1 | `source/router/classifier.spec.ts` | 3-tier classification, sticky routing, keyword fallback |
| Phase 2 | `source/pipeline/executor.spec.ts` | All stage types, branch/loop, error handling |
| Phase 3 | `source/context/budget.spec.ts` | Budget calculation, priority shrinking |
| Phase 4 | `source/pipeline/extractor.spec.ts` | JSON parsing, repair retry, schema extraction |
| Phase 5 | `source/skills/learned-matcher.spec.ts` | Keyword scoring, threshold, progressive disclosure |
| Phase 6 | `source/learnings/pattern-matcher.spec.ts` | Error pattern detection, recovery map lookup |
| Phase 7 | (modify existing compact tests) | Structured summary, tool-pair sanitization |
| Phase 8 | `source/router/complexity.spec.ts` | Simple vs complex message classification |
| Phase 10 | `source/context/observation-summarizer.spec.ts` | Summarization, fallback truncation |
| Phase 11 | `source/context/drift-detector.spec.ts` | Repeat detection, hedging detection |

### Integration Tests

- End-to-end router → specialist → tool execution with a mock local provider
- Pipeline execution with mocked LLM calls
- Context compaction with realistic conversation history
- Error learning and recovery flow

### Live Tests

- Test with actual Ollama instance and small models (phi4:14b, qwen2.5:3b)
- Verify router classification accuracy on real messages
- Verify pipeline execution produces correct tool calls
- Measure latency impact of router hop (~50ms expected)

---

*This plan was generated from analysis of LocalClaw (`/Users/deniz.okcu/development/LocalClaw`) and Nanocoder (`/Users/deniz.okcu/development/nanocoder`).*
