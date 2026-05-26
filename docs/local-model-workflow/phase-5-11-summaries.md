# Phase 5: Self-Improving Skills System
# Phase 6: Error Learning & Recovery
# Phase 7: Proactive Context Compaction
# Phase 8: Smart Model Routing
# Phase 9: Multi-Model Strategy
# Phase 10: Tool Observation Summarization
# Phase 11: Hallucination & Drift Detection

---

> **Note:** Phases 5–11 are documented in the main plan at
> `docs/local-model-workflow-plan.md`. Each phase has a complete
> description including LocalClaw reference, architecture, files to
> create/modify, test plan, and acceptance criteria.
>
> When starting any of these phases, create a dedicated file like the
> phase 1–4 files in this directory, following the same structure:
>
> 1. Status / Priority / Dependencies
> 2. Goal
> 3. Background (with LocalClaw reference)
> 4. Architecture
> 5. Files to Create (with code examples)
> 6. Files to Modify
> 7. Test Plan
> 8. Acceptance Criteria
> 9. LocalClaw References

---

## Quick Reference: Phase Summaries

### Phase 5: Self-Improving Skills (P3, depends on Phase 2)
- **What:** Record successful multi-step task executions as reusable skills
- **LocalClaw ref:** `src/skills/store.ts`, `src/skills/matcher.ts`
- **Key files:** `source/skills/learned-store.ts`, `source/skills/learned-matcher.ts`
- **Key idea:** After a successful task (>3 tool calls, >60% success), save the execution pattern. Next time, load the skill instead of planning from scratch. Keyword-overlap scoring with success count bonus.

### Phase 6: Error Learning & Recovery (P1, independent)
- **What:** Record tool failures in JSONL, provide tool-specific recovery hints
- **LocalClaw ref:** `src/learnings/error-store.ts`, `src/learnings/pattern-matcher.ts`
- **Key files:** `source/learnings/error-store.ts`, `source/learnings/recovery-map.ts`, `source/learnings/pattern-matcher.ts`
- **Key idea:** Before executing a tool, check for past errors. After execution, enrich observations with tool-specific recovery guidance. Promote recurring patterns (3+ occurrences) to `LEARNINGS.md`.

### Phase 7: Proactive Context Compaction (P1, depends on Phase 3)
- **What:** Compact at 50% of budget with structured summary template
- **LocalClaw ref:** `src/context/compactor.ts`
- **Key files:** Modify `source/commands/compact.ts`, `source/hooks/chat-handler/`
- **Key idea:** Use structured Goal/Progress/Decisions/Files summary template. Compact at 50% (not 60%). Sanitize orphaned tool_call/result pairs. Flush key facts before compacting.

### Phase 8: Smart Model Routing (P2, depends on Phase 1)
- **What:** Route simple messages to a faster/smaller model
- **LocalClaw ref:** `src/dispatch.ts:shouldUseQuickModel()`
- **Key files:** `source/router/complexity.ts`, modify `source/hooks/chat-handler/`
- **Key idea:** Messages <160 chars without code blocks or task keywords → fast model. Everything else → full model. Config: `fastModel` and `fullModel` in local model workflow settings.

### Phase 9: Multi-Model Strategy (P3, depends on Phase 8)
- **What:** Different models for different roles (router, chat, code, reasoning)
- **LocalClaw ref:** `localclaw.config.json5.example` — 9 model roles
- **Key files:** Modify `source/config/`, create `source/tools/reason-tool.tsx`
- **Key idea:** Add a `reason` tool that hands off to a dedicated reasoning model. The reasoning model never calls tools — only thinks and returns text. Role-based model config in `localModelWorkflow.models`.

### Phase 10: Tool Observation Summarization (P3, depends on Phase 3)
- **What:** LLM-summarize old tool observations instead of hard-truncating
- **LocalClaw ref:** `src/tool-loop/engine.ts:trimToolLoopMessages()` with optional summarizer
- **Key files:** `source/context/observation-summarizer.ts`, modify `source/hooks/useToolHandler.tsx`
- **Key idea:** Observations >1000 chars → LLM summarize (preserving key data). Observations 300–1000 → hard-truncate. <300 → keep. Falls back to truncation if summarization fails.

### Phase 11: Hallucination & Drift Detection (P2, independent)
- **What:** Detect narrated tool calls, repeating patterns, hedging language
- **LocalClaw ref:** `src/tool-loop/engine.ts` — context drift detection, hallucination detector
- **Key files:** `source/context/drift-detector.ts`, modify `source/hooks/useToolHandler.tsx`
- **Key idea:** Three drift signals: (1) same tool+params called twice, (2) 4+ hedging words, (3) growing response without tool calls. When detected, inject re-anchor prompt. Also: verb-aware hallucination check (verify claimed actions against actual tool calls). Thinking token headroom: auto-increase `max_tokens` for thinking models.
