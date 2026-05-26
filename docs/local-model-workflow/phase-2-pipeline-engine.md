# Phase 2: Deterministic Pipeline Engine

> **Status:** Not started
> **Priority:** P2 (depends on Phases 1, 3, 4)
> **Depends on:** Phase 1 (Router), Phase 3 (Budget), Phase 4 (Extractor)
> **Blocks:** Phase 5 (Self-Improving Skills)

---

## Goal

Create a deterministic pipeline engine where code controls the workflow and the LLM only extracts parameters and synthesizes text. This eliminates the problem of local models making poor decisions about which step to execute next.

## Background

**From LocalClaw:** Most agent frameworks let the model decide "what step next" in a ReAct loop. Local models fail at this — they call tools in wrong order, call unnecessary tools, and burn iterations. LocalClaw solved this with templated pipelines: code defines the exact sequence of steps, and the model only handles focused sub-tasks (parameter extraction, text synthesis).

**Key insight from LocalClaw DECISIONS.md:**
> "Local models can't self-regulate in open-ended tool loops for simple tasks. Pipeline for simple commands, ReAct for complex multi-tool tasks."

---

## Architecture

### Pipeline = Sequence of Typed Stages

```typescript
type PipelineStage =
  | ExtractStage     // Ask LLM to extract structured params
  | ToolStage        // Call a specific tool with computed params
  | LlmStage         // Ask LLM to synthesize/analyze/format
  | CodeStage        // Run deterministic TypeScript logic
  | BranchStage      // Route to sub-pipeline based on code decision
  | LlmBranchStage   // Route based on LLM single-word classification
  | LoopStage        // Repeat stages N times or until condition
  | ParallelToolStage // Call a tool N times concurrently
```

### Pipeline Flow

```
User: "Change the auth middleware to use JWT instead of sessions"

[Router] → category: code_edit → pipeline: code_edit

Pipeline: code_edit
  ┌─────────────────────────────────────────────────────────┐
  │ Stage 1: extract                                        │
  │   Schema: { file: string, change: string }              │
  │   LLM returns: { "file": "auth/middleware.ts",          │
  │                   "change": "Replace session with JWT" } │
  ├─────────────────────────────────────────────────────────┤
  │ Stage 2: tool (read_file)                                │
  │   Params: { path: "auth/middleware.ts" }                 │
  │   Observation: "import express from 'express'..."        │
  ├─────────────────────────────────────────────────────────┤
  │ Stage 3: llm (plan changes)                              │
  │   Prompt: "Given this file and requested change, plan    │
  │            the exact string replacements needed"          │
  │   Returns: structured replacement plan                   │
  ├─────────────────────────────────────────────────────────┤
  │ Stage 4: tool (string_replace)                           │
  │   Params: { path, oldText, newText } from stage 3        │
  │   Observation: "Replaced 3 occurrences"                  │
  ├─────────────────────────────────────────────────────────┤
  │ Stage 5: llm (review)                                    │
  │   Prompt: "Review the changes and confirm they're correct"│
  │   Returns: summary of changes                            │
  └─────────────────────────────────────────────────────────┘
```

### Why This Works for Local Models

| ReAct Loop (current) | Pipeline (proposed) |
|----------------------|---------------------|
| Model decides which tool to call next | Code decides the sequence |
| Model decides when to stop | Pipeline ends when stages complete |
| Model may call wrong tool | Only correct tools are in the pipeline |
| Model may wander | Each stage has one focused purpose |
| 8+ iterations for simple tasks | 4–5 stages, zero wasted iterations |
| Model handles 15+ tools | Model handles 1 task per stage |

---

## Files to Create

### `source/pipeline/types.ts`

```typescript
import type { LLMClient } from '@/ai-sdk-client';
import type { ToolRegistry } from '@/tools/tool-registry';

// --- Context ---

export interface PipelineContext {
  userMessage: string;
  params: Record<string, unknown>;
  stageResults: Record<string, unknown>;
  steps: Array<{ tool?: string; params?: Record<string, unknown>; observation?: string }>;
  client: LLMClient;
  toolRegistry: ToolRegistry;
  workingDirectory: string;
  sessionId: string;
  history?: Array<{ role: string; content: string }>;
  workspaceContext?: string;
  model: string;
  routerModel?: string;
  abort?: boolean;
  answer?: string;
  onStream?: (delta: string) => void;
}

// --- Stage Types ---

interface BaseStage {
  name: string;
  when?: (ctx: PipelineContext) => boolean;
}

export interface ExtractStage extends BaseStage {
  type: 'extract';
  schema: Record<string, { type: string; description: string; required?: boolean; enum?: string[] }>;
  examples?: Array<{ input: string; output: Record<string, unknown> }>;
  context?: (ctx: PipelineContext) => string;
}

export interface ToolStage extends BaseStage {
  type: 'tool';
  tool: string;
  resolveParams: (ctx: PipelineContext) => Record<string, unknown>;
}

export interface LlmStage extends BaseStage {
  type: 'llm';
  buildPrompt: (ctx: PipelineContext) => { system: string; user: string };
  model?: string;
  maxTokens?: number;
  temperature?: number;
  stream?: boolean;
}

export interface CodeStage extends BaseStage {
  type: 'code';
  execute: (ctx: PipelineContext) => unknown | Promise<unknown>;
}

export interface BranchStage extends BaseStage {
  type: 'branch';
  decide: (ctx: PipelineContext) => string;
  branches: Record<string, PipelineStage[]>;
}

export interface LlmBranchStage extends BaseStage {
  type: 'llm_branch';
  model?: string;
  prompt: string;
  options: string[];
  fallback: string;
  branches: Record<string, PipelineStage[]>;
}

export interface LoopStage extends BaseStage {
  type: 'loop';
  maxIterations: number;
  stages: PipelineStage[];
  continueIf: (ctx: PipelineContext, iteration: number) => boolean;
}

export interface ParallelToolStage extends BaseStage {
  type: 'parallel_tool';
  tool: string;
  resolveParamsList: (ctx: PipelineContext) => Record<string, unknown>[];
}

export type PipelineStage =
  | ExtractStage
  | ToolStage
  | LlmStage
  | CodeStage
  | BranchStage
  | LlmBranchStage
  | LoopStage
  | ParallelToolStage;

export interface PipelineDefinition {
  name: string;
  stages: PipelineStage[];
}

export interface PipelineResult {
  answer: string;
  iterations: number;
  hitMaxIterations: boolean;
  steps: Array<{ tool?: string; params?: Record<string, unknown>; observation?: string }>;
}
```

### `source/pipeline/executor.ts`

```typescript
import type { PipelineContext, PipelineStage, PipelineDefinition, PipelineResult } from './types';
import { extractParams } from './extractor';

export async function runPipeline(
  definition: PipelineDefinition,
  ctx: PipelineContext,
): Promise<PipelineResult> {
  const steps: PipelineResult['steps'] = [];

  for (const stage of definition.stages) {
    if (ctx.abort) break;

    // Check skip condition
    if (stage.when && !stage.when(ctx)) continue;

    const result = await executeStage(stage, ctx);
    ctx.stageResults[stage.name] = result;
  }

  return {
    answer: ctx.answer ?? '',
    iterations: definition.stages.length,
    hitMaxIterations: false,
    steps: ctx.steps,
  };
}

async function executeStage(stage: PipelineStage, ctx: PipelineContext): Promise<unknown> {
  switch (stage.type) {
    case 'extract': {
      const extraContext = stage.context ? stage.context(ctx) : undefined;
      const model = ctx.routerModel ?? ctx.model;
      const params = await extractParams(
        ctx.client, model, stage.schema, ctx.userMessage, stage.examples, extraContext,
      );
      Object.assign(ctx.params, params);
      return params;
    }

    case 'tool': {
      const params = stage.resolveParams(ctx);
      const toolDef = ctx.toolRegistry.getTool(stage.tool);
      if (!toolDef) throw new Error(`Tool not found: ${stage.tool}`);
      const observation = await toolDef.execute(params);
      ctx.steps.push({ tool: stage.tool, params, observation });
      return observation;
    }

    case 'llm': {
      const { system, user } = stage.buildPrompt(ctx);
      const response = await ctx.client.chat({
        model: stage.model ?? ctx.model,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        options: {
          temperature: stage.temperature ?? 0.5,
          maxTokens: stage.maxTokens ?? 2048,
        },
      });
      return response;
    }

    case 'code': {
      return await stage.execute(ctx);
    }

    case 'branch': {
      const branchKey = stage.decide(ctx);
      const branchStages = stage.branches[branchKey] ?? [];
      for (const subStage of branchStages) {
        await executeStage(subStage, ctx);
      }
      return branchKey;
    }

    case 'llm_branch': {
      // Single-word LLM classification
      const response = await ctx.client.chat({
        model: stage.model ?? ctx.routerModel ?? ctx.model,
        messages: [{ role: 'user', content: stage.prompt }],
        options: { temperature: 0.1, maxTokens: 10 },
      });
      const cleaned = response.trim().toLowerCase().replace(/[^a-z_]/g, '');
      const branchKey = stage.options.includes(cleaned) ? cleaned : stage.fallback;
      const branchStages = stage.branches[branchKey] ?? [];
      for (const subStage of branchStages) {
        await executeStage(subStage, ctx);
      }
      return branchKey;
    }

    case 'loop': {
      let lastResult: unknown;
      for (let i = 0; i < stage.maxIterations && stage.continueIf(ctx, i); i++) {
        for (const subStage of stage.stages) {
          lastResult = await executeStage(subStage, ctx);
        }
      }
      return lastResult;
    }

    case 'parallel_tool': {
      const paramsList = stage.resolveParamsList(ctx);
      const toolDef = ctx.toolRegistry.getTool(stage.tool);
      if (!toolDef) throw new Error(`Tool not found: ${stage.tool}`);
      const results = await Promise.all(
        paramsList.map(async (params) => {
          const observation = await toolDef.execute(params);
          ctx.steps.push({ tool: stage.tool, params, observation });
          return observation;
        }),
      );
      return results;
    }
  }
}
```

### `source/pipeline/registry.ts`

```typescript
import type { PipelineDefinition } from './types';

class PipelineRegistry {
  private pipelines = new Map<string, PipelineDefinition>();

  register(definition: PipelineDefinition): void {
    this.pipelines.set(definition.name, definition);
  }

  get(name: string): PipelineDefinition | undefined {
    return this.pipelines.get(name);
  }

  list(): string[] {
    return [...this.pipelines.keys()];
  }
}

export const pipelineRegistry = new PipelineRegistry();
```

### `source/pipeline/definitions/code-edit.ts`

```typescript
import type { PipelineDefinition } from '../types';

export const codeEditPipeline: PipelineDefinition = {
  name: 'code_edit',
  stages: [
    {
      type: 'extract',
      name: 'extract_edit_params',
      schema: {
        file: { type: 'string', description: 'File path to edit', required: true },
        change: { type: 'string', description: 'Description of the change to make', required: true },
      },
    },
    {
      type: 'tool',
      name: 'read_target_file',
      tool: 'read_file',
      resolveParams: (ctx) => ({ path: ctx.params.file }),
    },
    {
      type: 'llm',
      name: 'plan_edits',
      buildPrompt: (ctx) => ({
        system: 'You are a code editing specialist. Given a file and a change description, output the exact string replacements needed as JSON: [{ "oldText": "...", "newText": "..." }]. Return ONLY the JSON array.',
        user: `File: ${ctx.params.file}\nChange: ${ctx.params.change}\n\nFile contents:\n${ctx.stageResults.read_target_file}`,
      }),
      maxTokens: 4096,
      temperature: 0.1,
    },
    {
      type: 'code',
      name: 'parse_edits',
      execute: (ctx) => {
        const llmResult = ctx.stageResults.plan_edits;
        try {
          const edits = JSON.parse(typeof llmResult === 'string' ? llmResult : JSON.stringify(llmResult));
          ctx.params.edits = Array.isArray(edits) ? edits : [edits];
        } catch {
          ctx.params.edits = [];
        }
      },
    },
    {
      type: 'tool',
      name: 'apply_edits',
      tool: 'string_replace',
      resolveParams: (ctx) => ({
        path: ctx.params.file,
        oldText: ctx.params.edits[0]?.oldText ?? '',
        newText: ctx.params.edits[0]?.newText ?? '',
      }),
      when: (ctx) => Array.isArray(ctx.params.edits) && ctx.params.edits.length > 0,
    },
  ],
};
```

### `source/pipeline/definitions/code-search.ts`

```typescript
import type { PipelineDefinition } from '../types';

export const codeSearchPipeline: PipelineDefinition = {
  name: 'code_search',
  stages: [
    {
      type: 'extract',
      name: 'extract_search_params',
      schema: {
        query: { type: 'string', description: 'What to search for', required: true },
        scope: { type: 'string', description: 'Directory or file pattern to narrow search' },
      },
    },
    {
      type: 'tool',
      name: 'search_contents',
      tool: 'search_file_contents',
      resolveParams: (ctx) => ({
        pattern: ctx.params.query,
        path: ctx.params.scope ?? '.',
      }),
    },
    {
      type: 'tool',
      name: 'find_files',
      tool: 'find_files',
      resolveParams: (ctx) => ({
        pattern: ctx.params.scope ?? '*',
      }),
      when: (ctx) => !ctx.stageResults.search_contents,
    },
    {
      type: 'llm',
      name: 'synthesize',
      buildPrompt: (ctx) => ({
        system: 'You are a code exploration specialist. Summarize what you found. Be specific about file locations and line numbers.',
        user: `Query: ${ctx.params.query}\n\nSearch results:\n${ctx.stageResults.search_contents ?? ctx.stageResults.find_files}`,
      }),
      maxTokens: 2048,
      temperature: 0.3,
    },
  ],
};
```

---

## Integration with Router

In the chat handler (modified in Phase 1), after classification:

```typescript
if (categoryConfig.pipeline) {
  const pipeline = pipelineRegistry.get(categoryConfig.pipeline);
  if (pipeline) {
    const result = await runPipeline(pipeline, pipelineContext);
    // Stream the answer to the user
    return result;
  }
}

// Fall back to ReAct tool loop if no pipeline defined
```

---

## Test Plan

### `source/pipeline/executor.spec.ts`

```
Test: Extract stage
  - Calls LLM with schema, returns parsed params
  - Retries on JSON parse failure

Test: Tool stage
  - Calls registered tool with resolved params
  - Records step in ctx.steps

Test: Llm stage
  - Calls LLM with built prompt
  - Returns response text

Test: Code stage
  - Executes synchronous code
  - Can modify ctx.params

Test: Branch stage
  - Calls decide function, runs correct branch

Test: LlmBranch stage
  - Calls LLM, validates response against options
  - Falls back on invalid response

Test: Loop stage
  - Repeats stages until condition is false
  - Respects maxIterations

Test: Pipeline abort
  - Setting ctx.abort = true stops execution

Test: When guard
  - Stages with when() returning false are skipped

Test: End-to-end code_edit pipeline
  - Mock LLM returns file content and edits
  - Verifies tool calls are correct
```

---

## Acceptance Criteria

- [ ] All 8 stage types implemented and tested
- [ ] `code_edit` and `code_search` pipelines defined
- [ ] Pipeline registry allows registration and lookup
- [ ] Pipeline executor passes context between stages
- [ ] `when` guards skip stages correctly
- [ ] `abort` flag stops pipeline execution
- [ ] Integration with router: category → pipeline lookup works
- [ ] Fallback to ReAct loop when no pipeline is defined for a category
- [ ] All tests pass

---

## LocalClaw References

- `src/pipeline/types.ts` — Stage type definitions
- `src/pipeline/executor.ts` — Stage runner implementation
- `src/pipeline/registry.ts` — Pipeline registration
- `src/pipeline/definitions/` — 11 pipeline definitions (web-search, exec, memory, task, cron, plan, research, etc.)
- `src/pipeline/extractor.ts` — Structured parameter extraction with JSON repair
