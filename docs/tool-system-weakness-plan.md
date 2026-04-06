# Tool System Weakness Analysis and Fix Plan

## Single Biggest Weakness

The single biggest weakness in the current tool system is that **tool policy is fragmented across multiple layers, and the same tool can behave differently depending on the execution path**.

Instead of one authoritative definition for each tool, behavior is currently distributed across:

- per-tool `needsApproval` logic in individual tool files
- separate `validator` functions
- separate `readOnly` flags used for parallel execution
- `ToolRegistry` wrapper logic
- `ToolManager` filtering logic
- tune profiles in `source/tools/tool-profiles.ts`
- mode exclusions in `source/utils/prompt-builder.ts`
- non-interactive overrides in `source/ai-sdk-client/chat/chat-handler.ts`
- config-based always-allow logic in `source/config/nanocoder-tools-config.ts`
- MCP-specific approval logic in `source/mcp/mcp-client.ts`

This means **schema, validation, approval, availability, prompt visibility, and execution strategy are not derived from one canonical tool definition**.

## Why This Is the Biggest Weakness

This is the highest-impact problem because it affects both correctness and safety.

### 1. Inconsistent behavior across execution paths

The system has multiple execution paths:

- native AI SDK tool-calling
- manual/human-in-the-loop execution
- XML fallback tool-calling
- MCP-discovered tool execution

The code already has compensating logic to patch over these differences. For example, `ToolRegistry.getNativeTools()` wraps validators around execute functions so validation happens in native execution too. That is a sign that policy is duplicated and not naturally unified.

### 2. Policy drift risk

When adding or changing a tool, it is easy to update one layer and forget another. A tool can end up:

- visible in prompts but unavailable at runtime
- executable in one mode but hidden in another path
- validated in one path but not another
- parallelized based on incomplete safety metadata

### 3. Prompt/runtime mismatch

Prompt construction and runtime tool availability are filtered in separate places. That creates a risk that the model is told a tool exists when it is not actually available, or vice versa.

### 4. MCP tools are not first-class in the same policy model

Static tools have richer metadata and integration than MCP tools. MCP tools get approval behavior and execution, but not the same complete policy model for validation, formatting, availability, or execution strategy.

### 5. Parallel safety is too simplistic

`readOnly` is currently a single boolean. That is useful, but not expressive enough to model:

- tools that are read-only but expensive to parallelize
- tools that are safe in isolation but not in batches
- tools with shared resource contention
- tools with external side effects not captured by `readOnly`

## Evidence in the Codebase

Key files showing the fragmentation:

- `source/types/core.ts`
  - tool metadata exists, but not as a fully authoritative policy model
- `source/tools/index.ts`
  - builds separate registries for native tools, handlers, formatters, validators, and read-only flags
- `source/tools/tool-registry.ts`
  - reconstructs unified behavior from separately exported registries
- `source/tools/tool-manager.ts`
  - adds additional filtering and read-only checks
- `source/ai-sdk-client/chat/chat-handler.ts`
  - mutates tool approval behavior for non-interactive mode
- `source/utils/prompt-builder.ts`
  - separately decides what tools are visible by mode/profile
- `source/mcp/mcp-client.ts`
  - creates MCP tools with a separate policy path
- `source/hooks/chat-handler/conversation/tool-executor.tsx`
  - separately uses validator and read-only metadata for execution decisions
- `source/config/nanocoder-tools-config.ts`
  - adds another approval override source

## Goal

Refactor the tool system so that **each tool is defined once as a canonical capability object**, and all downstream behavior is derived from that source of truth.

That canonical definition should drive:

- schema
- execution
- validation
- approval
- availability
- prompt visibility
- formatting
- execution strategy
- mutability / parallel policy

## Recommended Fix Strategy

Use a two-phase approach.

---

## Phase 1: Centralize policy resolution without rewriting every tool

### Objective

Introduce a single policy resolution layer while keeping most existing tool exports compatible.

### Changes

#### 1. Add a central tool policy/resolution module

Create a new module, for example:

- `source/tools/tool-policy.ts`
- or `source/tools/tool-definition.ts`

This module should resolve effective behavior from:

- development mode
- tune profile
- non-interactive mode
- config allowlists
- MCP source
- tool metadata

#### 2. Make `ToolManager` the single runtime resolver

`ToolManager` should expose methods like:

- `getEffectiveTools(context)`
- `getEffectiveToolNames(context)`
- `getApprovalPolicy(toolName, context)`
- `getExecutionPolicy(toolName)`

This replaces scattered availability and approval logic in multiple modules.

#### 3. Update chat handling to consume resolved tools

Refactor `source/ai-sdk-client/chat/chat-handler.ts` so it does not rewrite tool approval behavior itself. It should consume already-resolved tools from the manager/policy layer.

#### 4. Update prompt building to use the same resolver

Refactor `source/utils/prompt-builder.ts` so prompt-visible tools come from the same effective tool set as runtime execution.

This removes prompt/runtime drift.

#### 5. Keep compatibility adapters for existing registries

Do not rewrite every tool file immediately. Instead, derive existing registry shapes from the new central model so the migration can be incremental.

### Benefits of Phase 1

- lower migration risk
- immediate reduction in policy drift
- prompt/runtime parity
- consistent behavior across modes and profiles
- minimal disruption to existing tools

---

## Phase 2: Make tool definitions canonical and first-class

### Objective

Replace the current multi-registry architecture with one canonical tool definition model.

### Changes

#### 1. Expand the core tool definition type

In `source/types/core.ts`, define a stronger canonical type for tools.

Suggested fields:

- `name`
- `tool`
- `handler`
- `validator`
- `formatter`
- `streamingFormatter`
- `riskLevel`
- `mutatesState`
- `executionMode` or `parallelSafety`
- `approvalPolicy`
- `availabilityPolicy`
- `source` (`static` or `mcp`)

#### 2. Refactor `source/tools/index.ts`

Stop treating separate registries as the primary source of truth.

Instead:

- export canonical tool definitions
- derive AI SDK tools, handlers, validators, and UI adapters from those definitions only as needed

#### 3. Simplify `ToolRegistry`

Refactor `source/tools/tool-registry.ts` so it stores canonical tool definitions directly instead of reconstructing full behavior from separate registries.

#### 4. Normalize MCP tools into the same model

Refactor `source/mcp/mcp-client.ts` so discovered MCP tools are wrapped into the same canonical structure as static tools.

Use conservative defaults for MCP tools:

- approval required unless explicitly allowed
- serial execution by default
- not assumed read-only unless explicitly configured

#### 5. Upgrade execution policy beyond `readOnly`

Refactor execution orchestration so it uses richer policy than a boolean flag.

Suggested levels:

- `serial`
- `parallel-safe`
- `parallel-batch-safe`

This allows better control over concurrency.

#### 6. Unify all execution paths around the same wrappers

Ensure native AI SDK execution, manual confirmation flow, and XML fallback all use the same validation and execution envelope.

## Proposed File Changes

### Create

- `source/tools/tool-policy.ts` or `source/tools/tool-definition.ts`

### Modify

- `source/types/core.ts`
- `source/tools/index.ts`
- `source/tools/tool-registry.ts`
- `source/tools/tool-manager.ts`
- `source/ai-sdk-client/chat/chat-handler.ts`
- `source/utils/prompt-builder.ts`
- `source/tools/tool-profiles.ts`
- `source/config/nanocoder-tools-config.ts`
- `source/mcp/mcp-client.ts`
- `source/hooks/chat-handler/conversation/tool-executor.tsx`
- `source/message-handler.ts`

### Update tests

- `source/tools/tool-manager.spec.ts`
- `source/tools/tool-registry.spec.ts`
- `source/tools/needs-approval.spec.ts`
- `source/hooks/chat-handler/conversation/tool-executor.spec.ts`
- `source/mcp/mcp-client.spec.ts`

## Step-by-Step Implementation Plan

1. Define a canonical tool policy model.
2. Introduce a central policy resolver module.
3. Refactor `ToolManager` to resolve effective tools from that module.
4. Update chat handling to consume resolved tools instead of mutating approval behavior inline.
5. Update prompt generation to use the exact same resolved tool set.
6. Add tests for prompt/runtime parity and cross-path execution consistency.
7. Migrate static tool registration to canonical definitions.
8. Bring MCP tools into the same canonical definition path.
9. Replace boolean `readOnly` with richer execution strategy metadata.
10. Remove compatibility cruft once parity is verified.

## Risks

### 1. Broad surface area

This touches core chat flow, prompt building, tool execution, and MCP integration.

### 2. Security regression risk

Approval behavior is safety-sensitive. Centralizing policy is good, but migration mistakes could accidentally under-protect dangerous tools.

### 3. Test churn

A meaningful refactor here will likely require updating several tests that currently assume the existing registry layering.

### 4. In-flight branch changes

There is already active work in this repo around prompts, tuning, and tools, so this should be coordinated carefully.

## Recommended Constraints During Refactor

- Preserve conservative defaults
- Treat MCP tools as serial unless explicitly marked otherwise
- Do not weaken approval rules during migration
- Add parity tests before removing legacy behavior
- Keep adapter layers until all execution paths are verified

## Suggested First Deliverable

The best first deliverable is **Phase 1 only**:

- central tool policy resolver
- `ToolManager` as the single effective-tool source
- prompt/runtime parity
- chat handler no longer mutating tool policy directly

This provides the highest ROI with the lowest risk.

## Open Questions for Discussion

1. Should we implement only Phase 1 first, or go directly to full canonical tool definitions?
2. Do you want strict prompt/runtime parity enforced in all modes?
3. Should MCP tools remain conservative by default unless explicitly annotated?
4. Do you want to preserve the current `readOnly` model temporarily as a compatibility layer during migration?
