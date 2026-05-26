# Phase 1: Router + Specialist Architecture

> **Status:** Not started
> **Priority:** P0 (foundational)
> **Depends on:** Nothing
> **Blocks:** Phases 2, 8, 9

---

## Goal

Create a lightweight intent classification layer that routes user messages to focused "specialists" — each seeing only a small subset of tools. This directly solves the #1 problem with local models: tool hallucination when given too many options.

## Background

**From LocalClaw:** When a 30B model sees 15+ tools, it hallucinates tool names and picks wrong tools. LocalClaw solved this with a Router (phi4:14b) that classifies intent, then dispatches to a Specialist that sees only 1–3 relevant tools. This made local models reliable for multi-step tool-calling tasks.

**Current Nanocoder:** The main chat handler sends all registered tools to the model on every request. The `minimal` and `nano` tune profiles reduce the tool set globally, but don't adapt per-request.

---

## Architecture

### Request Flow (Local Model Mode)

```
User Input
    │
    ▼
┌──────────────────────────────────────────────────────────┐
│  Router (phi4:14b, ~50ms)                                │
│  1. Check pre-model overrides (regex)                    │
│  2. If no override: classify with small model            │
│  3. If model fails: keyword heuristic fallback            │
│  4. If nothing matches: default to "chat"                 │
│  Returns: { category, confidence }                        │
└──────────────────────┬───────────────────────────────────┘
                       │
                       ▼
┌──────────────────────────────────────────────────────────┐
│  Category → Tool Set Lookup                               │
│  code_edit   → [read_file, write_file, string_replace,   │
│                 find_files, search_file_contents]         │
│  code_explore → [read_file, find_files,                   │
│                   search_file_contents, list_directory]   │
│  shell       → [execute_bash]                             │
│  git         → [git_status, git_diff, ...]               │
│  chat        → [] (no tools)                              │
└──────────────────────┬───────────────────────────────────┘
                       │
                       ▼
┌──────────────────────────────────────────────────────────┐
│  Specialist (main model, filtered tools only)             │
│  Receives: system prompt + filtered tools + history       │
│  Even a 7B model handles 3-5 tools reliably              │
└──────────────────────────────────────────────────────────┘
```

### When Router Activates

The router is active only when:
1. `localModelWorkflow.enabled === true` in config, OR
2. The active provider is detected as local (Ollama, llama.cpp, LM Studio, MLX, vLLM, LocalAI, llama-swap) AND `localModelWorkflow.activateForLocalProviders !== false`

For cloud providers (Anthropic, OpenAI, Google, OpenRouter), the existing tool-calling path is used unchanged.

---

## Files to Create

### `source/router/types.ts`

```typescript
export type SpecialistCategory =
  | 'chat'
  | 'code_edit'
  | 'code_explore'
  | 'shell'
  | 'git'
  | 'web'
  | 'task'
  | 'multi';    // complex multi-step, falls back to full tool set

export interface ClassifyResult {
  category: SpecialistCategory;
  confidence: 'pre_model_override' | 'model' | 'keyword' | 'sticky' | 'fallback';
}

export interface RouterConfig {
  model: string;
  timeout: number;
  defaultCategory: SpecialistCategory;
  categories: Record<string, { description: string }>;
}
```

### `source/router/classifier.ts`

The main classifier implementing the 3-tier fallback:

```typescript
export async function classifyMessage(
  client: LLMClient,
  config: RouterConfig,
  message: string,
  previousCategory?: SpecialistCategory,
): Promise<ClassifyResult>
```

**3-tier logic (from LocalClaw `src/router/classifier.ts`):**

1. **Pre-model overrides** — regex patterns that always win:
   - Message starts with `!` → `shell`
   - Message contains `@file` → `code_edit`
   - Message contains `git commit/push/pull/status` → `git`
   - Message contains `/tasks` → `task`
   - Message starts with `/` (slash command) → skip routing entirely (handle as command)

2. **Model classification** — call the router model:
   - System prompt: "Classify this message into one category: ..."
   - `temperature: 0.1, max_tokens: 20`
   - Timeout after `config.timeout` ms (default 2000ms)
   - Validate response against category list

3. **Keyword heuristics** — ordered by specificity:
   ```
   "search|find|look up"         → code_explore
   "fix|debug|error|bug"         → code_edit
   "run|execute|build|test"      → shell
   "commit|push|pull|branch"     → git
   "search web|google|lookup"    → web
   "task|todo"                   → task
   ```

4. **Default** → `chat`

**Sticky routing (from LocalClaw):**
- If `previousCategory` is `chat` or `code_explore`, and the message looks like a follow-up (short, no strong new-topic signals), stay on the same category
- Break sticky when: explicit task keywords, long messages (>200 chars), greetings, commands

### `source/router/prompt.ts`

Build the router classification prompt:

```typescript
export function buildRouterPrompt(message: string, config: RouterConfig): string {
  const categories = Object.entries(config.categories)
    .map(([name, def]) => `${name}: ${def.description}`)
    .join('\n');

  return `Classify this message into exactly one category. Return ONLY the category name, nothing else.

Categories:
${categories}

Message: "${message}"

Category:`;
}
```

### `source/router/keyword-hints.ts`

Export the keyword pattern table:

```typescript
export const KEYWORD_HINTS: Array<{ pattern: RegExp; category: SpecialistCategory }> = [
  // Ordered by specificity — most specific first
  { pattern: /\b(git\s+(commit|push|pull|add|branch|stash|reset|log|diff|status))\b/i, category: 'git' },
  { pattern: /\b(run|execute|build|test|start|npm|pip|cargo)\b/i, category: 'shell' },
  { pattern: /\b(fix|debug|error|bug|refactor|implement|change|update|modify)\b.*\b(in|of|the|file|function|class)\b/i, category: 'code_edit' },
  { pattern: /\b(search|find|where|locate|grep)\b.*\b(is|are|defined|implemented|located|used)\b/i, category: 'code_explore' },
  { pattern: /\b(what|how|explain|understand|read|review)\b.*\b(this|the|code|file|function)\b/i, category: 'code_explore' },
  { pattern: /\b(search\s+(web|online|google)|look\s+up|find\s+out)\b/i, category: 'web' },
  { pattern: /\b(task|todo|checklist)\b/i, category: 'task' },
];
```

### `source/router/complexity.ts`

Smart model routing helper (used in Phase 8 but defined here):

```typescript
export function assessMessageComplexity(message: string): { isSimple: boolean; reason?: string } {
  const trimmed = message.trim();
  if (trimmed.length > 160) return { isSimple: false, reason: 'long_message' };
  if (/`/.test(trimmed)) return { isSimple: false, reason: 'code_blocks' };
  if (/\b(search|find|refactor|debug|fix|implement|create|build|write|deploy)\b/i.test(trimmed)) {
    return { isSimple: false, reason: 'task_intent' };
  }
  return { isSimple: true };
}
```

---

## Files to Modify

### `source/hooks/chat-handler/`

In the main chat handler, add a routing step before the LLM call:

```typescript
// Pseudo-code for integration point
async function handleUserMessage(message: string) {
  const isLocalModel = detectLocalProvider(activeProvider);

  if (localModelWorkflow.enabled || (isLocalModel && localModelWorkflow.activateForLocalProviders)) {
    // Route through specialist system
    const result = await classifyMessage(routerClient, routerConfig, message, previousCategory);
    const filteredTools = getToolsForCategory(result.category);
    previousCategory = result.category;

    // Call LLM with filtered tools only
    await streamChat(mainClient, filteredTools, message);
  } else {
    // Existing behavior: all tools
    await streamChat(mainClient, allTools, message);
  }
}
```

### `source/config/validation.ts`

Add the `localModelWorkflow` config schema:

```typescript
localModelWorkflow: {
  enabled: { type: 'boolean', default: false },
  activateForLocalProviders: { type: 'boolean', default: true },
  router: {
    model: { type: 'string', required: true },
    timeout: { type: 'number', default: 2000 },
    defaultCategory: { type: 'string', default: 'chat' },
  },
  categories: {
    type: 'object',
    default: { /* see config reference in main plan */ },
  },
}
```

---

## Test Plan

### `source/router/classifier.spec.ts`

```
Test: Pre-model overrides
  - "!git status" → shell
  - "@src/app.tsx review this" → code_edit
  - "/tasks add something" → skip (slash command)
  - "git commit my changes" → git

Test: Model classification (mocked LLM)
  - "Fix the auth bug" → code_edit
  - "Where is the User model defined?" → code_explore
  - "Run the tests" → shell
  - "What do you think about microservices?" → chat
  - "Search the web for ..." → web

Test: Keyword fallback (when model times out)
  - "debug the login error" → code_edit
  - "show me the git log" → git

Test: Sticky routing
  - Previous: chat, message: "tell me more" → chat (sticky)
  - Previous: chat, message: "fix the bug in auth.ts" → code_edit (new topic breaks sticky)
  - Previous: code_edit, message: "now run the tests" → shell (not sticky, code_edit is not sticky category)

Test: Default fallback
  - "asdfgh" → chat
```

---

## Acceptance Criteria

- [ ] Router classifies messages with 3-tier fallback
- [ ] Each specialist category has a defined tool set (max 5 tools per category)
- [ ] Router activates only for local providers (unless explicitly enabled)
- [ ] Sticky routing works for conversation-oriented categories
- [ ] Router timeout doesn't block the main chat flow (falls back gracefully)
- [ ] All tests pass
- [ ] No regression for cloud provider tool calling

---

## LocalClaw References

- `src/router/classifier.ts` — 3-tier classification with pre-model overrides, keyword fallback, sticky routing
- `src/dispatch.ts` — Integration point: classify → dispatch → specialist
- `src/router/prompt.ts` — Router prompt builder
- `localclaw.config.json5.example` — Router config with categories and descriptions
