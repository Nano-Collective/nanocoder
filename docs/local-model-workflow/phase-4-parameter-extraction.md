# Phase 4: Structured Parameter Extraction

> **Status:** Not started
> **Priority:** P1
> **Depends on:** Nothing (standalone utility)
> **Blocks:** Phase 2 (Pipeline Engine uses this)

---

## Goal

Create a focused LLM-based parameter extraction utility that reliably pulls structured parameters from user messages. This is the critical primitive that makes deterministic pipelines work — the model only needs to return JSON, not decide which tool to call.

## Background

**From LocalClaw:** Instead of giving the model the user's message + all tools and hoping it calls the right one, LocalClaw's pipelines make a focused extraction call first. The model receives only a parameter schema and returns JSON. This is reliable even for small models because:
1. The task is scoped to one thing (extract params)
2. Temperature is 0.1 (near-deterministic)
3. The model returns JSON only (no tool calling needed)
4. JSON repair retry handles malformed output

---

## Architecture

### Extraction Flow

```
User: "Change the auth middleware in src/middleware.ts to use JWT"

Extraction Call:
  System: "Extract the following parameters from the user's message as a JSON object.
           - 'file' (string, required): File path to edit
           - 'change' (string, required): Description of the change"
  User: "Change the auth middleware in src/middleware.ts to use JWT"

Model Response: {"file": "src/middleware.ts", "change": "Replace session-based auth with JWT in auth middleware"}
```

### JSON Repair Retry

If the model returns malformed JSON:

```
Attempt 1: "{file: 'src/middleware.ts', change: 'Replace session auth with JWT'}"
  → Parse fails (unquoted keys)

Retry prompt: "That was not valid JSON. Return ONLY a JSON object like {\"key\": \"value\"}, nothing else."
Retry response: {"file": "src/middleware.ts", "change": "Replace session-based auth with JWT"}
  → Parse succeeds
```

---

## Files to Create

### `source/pipeline/extractor.ts`

```typescript
import type { LLMClient } from '@/ai-sdk-client';

export interface FieldSchema {
  type: string;
  description: string;
  required?: boolean;
  enum?: string[];
}

export interface ExtractionExample {
  input: string;
  output: Record<string, unknown>;
}

/**
 * Build a focused extraction prompt from a schema definition.
 * The LLM returns ONLY a JSON object — no reasoning, no explanation.
 *
 * From LocalClaw: src/pipeline/extractor.ts
 */
export function buildExtractionPrompt(
  schema: Record<string, FieldSchema>,
  userMessage: string,
  examples?: ExtractionExample[],
  extraContext?: string,
): { system: string; user: string } {
  const fields = Object.entries(schema)
    .map(([name, field]) => {
      let line = `- "${name}" (${field.type}${field.required ? ', required' : ', optional'}): ${field.description}`;
      if (field.enum) line += ` — one of: ${field.enum.join(', ')}`;
      return line;
    })
    .join('\n');

  let system = `Extract the following parameters from the user's message as a JSON object.\n\n${fields}\n\nReturn ONLY a valid JSON object. No explanation, no markdown, no extra text.`;

  if (extraContext) {
    system += `\n\nReference data:\n${extraContext}`;
  }

  if (examples && examples.length > 0) {
    const exLines = examples
      .map(ex => `Input: "${ex.input}"\nOutput: ${JSON.stringify(ex.output)}`)
      .join('\n\n');
    system += `\n\nExamples:\n${exLines}`;
  }

  return { system, user: userMessage };
}

/**
 * Try to parse JSON from a string, handling common LLM output issues:
 * - Wrapped in ```json ... ```
 * - Trailing text after the JSON
 * - Unquoted keys (best effort)
 */
export function tryParseJson(raw: string): Record<string, unknown> | null {
  // Strip markdown code fences
  let cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();

  // Try direct parse
  try {
    const parsed = JSON.parse(cleaned);
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // Try to find JSON object in the text
    const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      try {
        return JSON.parse(jsonMatch[0]);
      } catch {
        // Best-effort: fix unquoted keys
        const fixed = jsonMatch[0].replace(/(\w+)\s*:/g, '"$1":');
        try {
          return JSON.parse(fixed);
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

/**
 * Extract structured parameters from a user message via LLM.
 * Uses a focused prompt with temperature 0.1 for deterministic output.
 * Retries once with a repair prompt on parse failure.
 */
export async function extractParams(
  client: LLMClient,
  model: string,
  schema: Record<string, FieldSchema>,
  userMessage: string,
  examples?: ExtractionExample[],
  extraContext?: string,
): Promise<Record<string, unknown>> {
  const { system, user } = buildExtractionPrompt(schema, userMessage, examples, extraContext);

  const response = await client.chat({
    model,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    options: { temperature: 0.1, maxTokens: 256 },
  });

  const raw = typeof response === 'string' ? response : JSON.stringify(response);
  const parsed = tryParseJson(raw);
  if (parsed) return parsed;

  // Retry with repair prompt
  const repairResponse = await client.chat({
    model,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
      { role: 'assistant', content: raw },
      { role: 'user', content: 'That was not valid JSON. Return ONLY a JSON object like {"key": "value"}, nothing else.' },
    ],
    options: { temperature: 0.0, maxTokens: 256 },
  });

  const retryRaw = typeof repairResponse === 'string' ? repairResponse : JSON.stringify(repairResponse);
  const retryParsed = tryParseJson(retryRaw);
  if (retryParsed) return retryParsed;

  // Final fallback: return empty object with a warning
  console.warn(`[Extractor] Failed to parse params from: "${raw.slice(0, 100)}"`);
  return {};
}
```

---

## Usage Examples

### Code Edit Extraction

```typescript
const params = await extractParams(
  client, 'phi4:14b',
  {
    file: { type: 'string', description: 'File path to edit', required: true },
    change: { type: 'string', description: 'What to change', required: true },
  },
  'Fix the off-by-one error in the loop at line 45 of utils.ts',
  [
    { input: 'Change the auth check in middleware.ts', output: { file: 'middleware.ts', change: 'Change the auth check' } },
  ],
);
// Result: { file: 'utils.ts', change: 'Fix off-by-one error in the loop at line 45' }
```

### Task Extraction

```typescript
const params = await extractParams(
  client, 'phi4:14b',
  {
    title: { type: 'string', description: 'Task title', required: true },
    priority: { type: 'string', description: 'Priority level', enum: ['low', 'medium', 'high'] },
    dueDate: { type: 'string', description: 'Due date if mentioned' },
  },
  'Add a high-priority task to fix the login bug by Friday',
);
// Result: { title: 'Fix the login bug', priority: 'high', dueDate: 'Friday' }
```

### Search Extraction

```typescript
const params = await extractParams(
  client, 'phi4:14b',
  {
    query: { type: 'string', description: 'Search query', required: true },
    scope: { type: 'string', description: 'Directory or file pattern to narrow search' },
  },
  'Search for all uses of the authenticate function in the auth module',
);
// Result: { query: 'authenticate', scope: 'auth/' }
```

---

## Test Plan

### `source/pipeline/extractor.spec.ts`

```
Test: buildExtractionPrompt
  - Generates system prompt with field descriptions
  - Includes examples when provided
  - Includes extra context when provided

Test: tryParseJson
  - Valid JSON: returns parsed object
  - JSON in code fence: strips and parses
  - JSON with trailing text: extracts and parses
  - Unquoted keys: best-effort fix and parse
  - Non-JSON text: returns null

Test: extractParams (mocked LLM)
  - Model returns valid JSON: returns parsed params
  - Model returns malformed JSON: retries with repair prompt
  - Repair also fails: returns empty object with warning

Test: End-to-end extraction scenarios
  - "Fix the bug in src/app.tsx" → { file: 'src/app.tsx', change: 'Fix the bug' }
  - "Search for TODO comments in src/" → { query: 'TODO', scope: 'src/' }
  - "Run npm test" → { command: 'npm test' }
```

---

## Acceptance Criteria

- [ ] `extractParams()` reliably extracts structured JSON from user messages
- [ ] JSON repair retry handles common LLM formatting issues
- [ ] `tryParseJson()` handles code fences, trailing text, unquoted keys
- [ ] Temperature 0.1 ensures near-deterministic extraction
- [ ] Examples in the prompt improve extraction accuracy
- [ ] Extra context parameter supports pipeline-specific context injection
- [ ] All tests pass

---

## LocalClaw References

- `src/pipeline/extractor.ts` — Extraction with JSON repair retry
- `src/pipeline/types.ts` — `ExtractStage` type definition
