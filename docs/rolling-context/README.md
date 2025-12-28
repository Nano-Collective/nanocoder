# Rolling Context Feature

Provider-agnostic context management to prevent context overflow and enable long-running agent sessions.

## Objective

Eliminate runtime errors caused by exceeding model context limits through a **universal prompt management layer** that:

1. Estimates token usage before every request
2. Enforces a configurable context budget
3. Trims or summarizes old context when necessary
4. Works consistently across different LLM providers
5. Enables long-running agent sessions without crashes

## Design Philosophy

- **Safety over cleverness** — deterministic, predictable behavior
- **Provider-agnostic** — no reliance on provider-specific behavior
- **Client-side enforcement** — all safety logic happens before requests
- **Explicit budgets** — configurable limits, not implicit assumptions

## Quick Start

1. **Phase 0** - Add `/rolling-context` command (`PHASE0_COMMAND.md`) **<-- Start here**
2. **Phase 1** - Implement token budget enforcement (`PHASE1_TRUNCATION.md`)
3. **Phase 2** - Add file-aware retrieval (`PHASE2_FILE_RETRIEVAL.md`)
4. **Phase 3** - Optional summarization (`PHASE3_SUMMARIZATION.md`)

See `IMPLEMENTATION_PLAN.md` for full architecture overview.

## Key Files to Create/Modify

```
# Phase 0 - Command & Configuration
source/commands/rolling-context.tsx  # NEW - Toggle command
source/types/config.ts               # MODIFY - Add preference types
source/config/preferences.ts         # MODIFY - Add getter/setter
source/hooks/useAppInitialization.tsx # MODIFY - Register command

# Phase 1+ - Core Logic (Prompt Management Layer)
source/context/                      # NEW - Context management module
├── token-estimator.ts               # Token counting with pluggable tokenizers
├── context-budget.ts                # Budget enforcement logic
├── context-trimmer.ts               # Deterministic trimming algorithm
├── prompt-builder.ts                # Final prompt assembly
└── index.ts                         # Public API

source/hooks/chat-handler/use-chat-handler.tsx  # MODIFY - Integration point
```

## Default Behavior

**OFF by default.** Enable with `/rolling-context` command.

When enabled:
- Enforce context budget based on model limits
- Reserve tokens for output generation
- Trim old tool outputs and conversation history
- Preserve system prompts, active files, and recent turns
- Replace truncated content with metadata stubs or summaries

## Configuration

```json
{
  "contextManagement": {
    "enabled": true,
    "maxContextTokens": 128000,
    "reservedOutputTokens": 4096,
    "trimStrategy": "age-based",
    "summarizeOnTruncate": false
  }
}
```

## Usage

```bash
/rolling-context        # Toggle on/off
/rolling-context on     # Enable
/rolling-context off    # Disable
```

## Key Constraints

- LLM providers enforce **hard context limits**
- Providers **do not automatically trim input**
- Context overflow errors happen **before generation**
- Therefore, **all safety logic must happen client-side**
- The solution must **not rely on provider-specific behavior**
