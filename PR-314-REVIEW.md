# PR #314 Review: Plan Mode with Interactive Questions System

**Reviewer:** Claude
**Date:** 2026-01-20
**PR:** https://github.com/Nano-Collective/nanocoder/pull/314
**Verdict:** 🔴 **Request Changes**

---

## Summary

This is a substantial PR (~7,000 lines across 45 files) that introduces a structured 5-phase planning workflow with interactive questioning capabilities. The feature is well-architected overall, but has several issues that should be addressed before merging.

---

## 🔴 Critical Issues

### 1. Bug: Commands in Plan Mode Trigger Planning

**Severity: High**
**Reported by:** Maintainer

Running commands while in plan mode causes the system to begin planning instead of executing the command normally. This breaks the expected CLI behavior where slash commands should work regardless of mode.

**Expected behavior:** Commands like `/model`, `/clear`, etc. should execute normally in plan mode.

**Actual behavior:** Commands trigger plan mode behavior/planning.

**Recommendation:** Check command handling in `source/app/App.tsx` or `source/hooks/useAppHandlers.tsx` to ensure slash commands bypass plan mode prompt injection.

---

### 2. Bug: Status Not Updating When Switching to Plan Mode Mid-Request

**Severity: Medium-High**
**Reported by:** Maintainer

If you send a prompt (hit Enter) and then switch to plan mode while the request is in flight, the status indicator does not update to show "Formulating Plan" - it continues showing the normal status.

**Expected behavior:** When switching to plan mode during an active request, the status should update to reflect the new mode (e.g., "Formulating Plan").

**Actual behavior:** Status indicator remains unchanged, showing normal mode status.

**Likely cause:** The status component reads mode at render time but doesn't re-render when mode changes mid-stream. This is another symptom of the race condition issues with module-level state in `mode-context.ts`.

**Recommendation:** Check `source/components/status.tsx` and ensure it subscribes to mode changes reactively, or prevent mode switching while a request is in progress.

---

### 3. No Test Coverage

**Severity: High**

The PR adds 15+ new source files but no corresponding test files (`.spec.ts`). The PR description acknowledges this: *"Comprehensive test coverage planned for follow-up PR"*

This is problematic because:
- `PlanManager` does filesystem operations - needs tests for edge cases
- `PlanValidator` regex patterns need test coverage
- Tool permission logic in `tool-manager.ts` is security-critical

**Recommendation:** At minimum, add tests for:
- `source/services/plan-manager.ts` - CRUD operations, edge cases
- `source/services/plan-validator.ts` - validation rules
- `source/tools/tool-manager.ts` - `isToolAllowedInPlanMode()` function

---

### 4. Race Condition Risk in Mode Context

**Severity: Medium**

`source/context/mode-context.ts` uses module-level mutable state:

```typescript
let currentMode: DevelopmentMode = 'normal';
let currentPlanSummary: string = '';
// ... many more module-level variables
```

This global state pattern can lead to race conditions if multiple operations access it concurrently. The code even has a comment in `App.tsx:75-82` acknowledging this as a "backup synchronization mechanism."

**Recommendation:** Consider using React Context with proper state management instead of module-level variables, or add mutex/locking for concurrent access.

---

### 5. Potential Path Traversal in `isPlanFilePath`

**Severity: Medium**
**File:** `source/services/plan-manager.ts:410-434`

```typescript
isPlanFilePath(targetPath: string): boolean {
  const absoluteTarget = path.resolve(targetPath);
  const plansDir = path.resolve(this.getPlansDir());
  const relativePath = path.relative(plansDir, absoluteTarget);

  if (relativePath.startsWith('..')) {
    return false;
  }
  // ...
}
```

While the `..` check exists, the `path.resolve()` call could normalize paths like `/.nanocoder/plans/../../../etc/passwd` in unexpected ways depending on the base path. This function gates write permissions in plan mode.

**Recommendation:** Add more robust path validation, possibly using `realpath` after resolution, and add test cases for path traversal attempts.

---

### 6. Bug: Tool Calls Continue During Question Mode (Blocking Issue)

**Severity: High**
**Reported by:** Maintainer
**File:** `source/tools/interactive/ask-user-question.tsx`

When the `ask_user_question` tool is called, tool calls continue executing in the background. The user cannot see the questions because planning stages progress without waiting for answers.

**Expected behavior:** When questions are displayed, the LLM should BLOCK and wait for the user to answer before continuing.

**Actual behavior:** The tool returns immediately with a message, and the LLM continues executing other tool calls. Planning proceeds without user input.

**Root cause:** The `executeAskUserQuestion` function calls `triggerQuestionPrompt()` but returns immediately without waiting for the callbacks:

```typescript
const questionTriggered = triggerQuestionPrompt(
  questions,
  (answers) => { /* callback */ },
  () => { /* cancel callback */ },
);
// Returns immediately without waiting!
return `I need to ask you ${questions.length} question(s)...`;
```

**Recommendation:** The tool must return a Promise that only resolves when the user submits their answers or cancels. This requires architectural changes to make the tool execution await user input.

---

### 7. Bug: Multi-Select Questions Are Broken (Blocking Issue)

**Severity: High**
**Reported by:** Maintainer
**File:** `source/components/interactive-question-prompt.tsx`

Multi-select questions don't allow progressing past the first option. Pressing Enter doesn't advance to the next question. User got stuck at question 3/4.

**Root cause:** In the parent component's `useInput` handler:

```typescript
} else if (key.return && !questions[currentQuestionIndex].multiSelect) {
  // Enter ONLY works for single-select!
  handleNextQuestion();
}
```

Enter key handling is explicitly disabled for multi-select questions. There's a hint that says "Press Enter to continue" but the code doesn't handle it.

**Recommendation:** Add Enter key handling for multi-select questions to call `handleNextQuestion()`.

---

### 8. Bug: "Other" Option Cannot Be Selected or Typed

**Severity: Medium-High**
**Reported by:** Maintainer
**File:** `source/components/interactive-question-prompt.tsx`

Users cannot select and type in the "Other" option in question responses.

**Likely cause:** The "Other" option rendering code appears incomplete (comment shows `{/* "Other" option for custom input */}` but the implementation seems partial). The custom input mode toggle (`setIsCustomInputMode(true)`) happens in `SingleQuestion` but interaction between the nested `useInput` handlers may be conflicting.

**Recommendation:** Review the "Other" option implementation and ensure the custom input mode works correctly with text input.

---

### 9. Bug: "Formulating Plan" Has No Bottom Margin

**Severity: Low**
**Reported by:** Maintainer
**File:** `source/components/plan-mode-indicator.tsx`

The "⏳ Formulating plan..." message has no margin on the bottom, so the user's message appears right up against it.

**Root cause:** `PlanModeIndicator` has `marginTop={1}` but no `marginBottom`:

```typescript
return (
  <Box marginTop={1}>  {/* No marginBottom */}
    <Text color={successColor}>
```

**Recommendation:** Add `marginBottom={1}` to the Box in PlanModeIndicator.

---

### 10. Bug: User Message Appears After "Formulating Plan" Delay

**Severity: Medium**
**Reported by:** Maintainer

There's a noticeable delay between "Formulating Plan" appearing and the user's message appearing. The user's message should appear first, then the status indicator.

**Expected behavior:** User submits message → message appears immediately → then "Formulating Plan" status shows.

**Actual behavior:** User submits message → delay → "Formulating Plan" appears → delay → user message appears.

**Recommendation:** Review message rendering order in App.tsx/conversation-loop.tsx to ensure user messages render before status updates.

---

### 11. Bug: Escape Cancels Plan and Creates New Cycle

**Severity: Medium**
**Reported by:** Maintainer

When pressing Escape to cancel the plan, it resets everything and creates a whole new plan cycle for the same message, even when the user wanted to continue with the existing plan.

**Expected behavior:** Escape should either:
- Cancel and return to normal mode (keeping context), OR
- Ask user what they want to do

**Actual behavior:** Escape cancels and restarts planning from scratch with a new plan.

**Recommendation:** Add confirmation before canceling, or provide option to resume existing plan.

---

### 12. Question: Does Question UI Follow Theme?

**Severity: Low (UX Question)**
**Reported by:** Maintainer
**File:** `source/components/interactive-question-prompt.tsx`

Does the question UI follow the user's theme setup, or is it always the same green color regardless of theme chosen?

**Finding:** The interactive question prompt has **hardcoded colors**:

```typescript
color="#00ff00"  // Hardcoded green throughout
```

Unlike `PlanModeIndicator` which accepts theme colors as props, the question prompt does not use theme colors.

**Recommendation:** Pass theme colors to `InteractiveQuestionPrompt` and use them instead of hardcoded values.

---

### 13. UX: "Plan Mode" Label Should Say "Plan Stage"

**Severity: Low (UX)**
**Reported by:** Maintainer
**File:** `source/components/plan-mode-indicator.tsx`

The UI shows: `Plan Mode: 🔍 Understanding | continue-implementation`

Suggestion: Should it say "Plan Stage" instead of "Plan Mode" to better describe what it's showing?

**Recommendation:** Consider renaming to "Plan Stage" or "Planning Phase" for clarity.

---

## 🟡 Moderate Issues

### 14. Callback Leak in Interactive Question Prompt

**Severity: Low-Medium**
**File:** `source/components/interactive-question-prompt.tsx`

The `useInput` hook doesn't properly clean up when the component unmounts. If the user rapidly cancels/submits, callbacks might fire on unmounted components.

```typescript
useInput((input, key) => {
  if (!isActive) return;
  // ... handles input
});
```

**Recommendation:** Add cleanup in `useEffect` to prevent state updates on unmounted components.

---

### 15. Duplicate Entries in Word Lists

**Severity: Low**
**File:** `source/utils/plan/slug-generator.ts`

There are duplicate entries in the word lists:
- `ADJECTIVES`: "careful" appears twice, "organized" appears twice, "inquisitive" appears twice, "analytical" appears twice
- `VERBS`: "extending" appears twice
- `NOUNS`: "module" appears twice, "handler" appears twice

**Recommendation:** Deduplicate the word lists.

---

### 16. Potential Non-Unique Summary After Loop

**Severity: Low-Medium**
**File:** `source/services/plan-manager.ts:200-209`

```typescript
private async ensureUniqueSummary(
  baseSummary: string,
  existingSummaries: Set<string>,
): Promise<string> {
  let summary = baseSummary;
  let counter = 2;

  while (existingSummaries.has(summary) && counter < 100) {
    summary = `${baseSummary}-${counter}`;
    counter++;
  }
  return summary;
}
```

If there are 99+ plans with the same base name, this returns a non-unique summary.

**Recommendation:** Throw an error or add a fallback with timestamp/random suffix after the loop.

---

### 17. Missing Timeout in Exit Plan Mode

**Severity: Low-Medium**
**File:** `source/tools/plan/exit-plan-mode.tsx:75-100`

If `triggerModeSelection` returns `true` but the user never interacts with the prompt (e.g., the component unmounts), the promise never resolves and plan mode state may be left inconsistent.

**Recommendation:** Add timeout handling or ensure cleanup resets plan mode state.

---

## 🟢 Strengths

### Well-Structured Architecture
- Clean separation of concerns between services (`PlanManager`, `PlanValidator`, `TemplateService`)
- Good use of the registry pattern for callbacks
- Comprehensive type definitions (`types/validation.ts`, `types/templates.ts`, `types/core.ts`)

### Good Security Considerations
- Tool restrictions in plan mode properly implemented via `isToolAllowedInPlanMode()`
- `write_file` only permits writing to plan documents during plan mode
- Directory validation before creating plans prevents arbitrary file writes

### Thoughtful UX Design
- Interactive keyboard navigation
- Multi-select and custom "Other" input support
- Clear phase indicators and progress feedback

### Comprehensive Validation System
- Structural validation checks for required sections
- Business rule validation (content length, task counts, placeholder detection)
- Cross-document validation for consistency

---

## 🟠 Suggestions for Improvement

### 18. Type Safety for Tool Arguments
Several places use type assertions or `any` for tool arguments. Consider using discriminated unions or zod schemas for runtime validation.

### 19. Consider Debouncing `useInput` Handlers
The keyboard navigation could benefit from debouncing to prevent rapid key presses from causing issues.

### 20. Atomic File Writes Consistency
`plan-manager.ts` implements atomic writes for documents via temp file + rename, but `generateInitialProposalContent` writes directly. Consider using atomic writes consistently.

### 21. Consider Splitting the PR
Given the size (~7k lines), consider splitting into:
- Core plan mode infrastructure (services, types)
- Interactive questioning system
- UI components and integration

---

## Files Changed Summary

| Category | Files | Lines |
|----------|-------|-------|
| New Components | 4 | ~900 |
| New Services | 3 | ~1,200 |
| New Tools | 3 | ~750 |
| New Types | 3 | ~450 |
| New Utils | 6 | ~1,500 |
| New Templates | 5 | ~350 |
| Modified Files | 14 | ~1,800 |
| **Total** | **45** | **~7,000** |

---

## Test Prompt Used

The following prompt was used to test the plan mode feature:

> Can you come up with a plan for implementing a file tree and file viewer. Essentially, you can run /explorer and it opens it in project mode. You can traverse the project, search for files, open and view files, attach as context. All of it.

**Testing Status:** ⚠️ **Incomplete** - Could not complete full plan flow testing due to the multi-select question bug (Issue #7). Got stuck at question 3/4 and could not proceed.

---

## Checklist Before Merge

### Critical (Blocking)
- [ ] Fix `ask_user_question` tool to block until user answers (Issue #6)
- [ ] Fix multi-select questions - Enter key doesn't progress (Issue #7)
- [ ] Fix "Other" option selection and text input (Issue #8)
- [ ] Fix command execution bug in plan mode (Issue #1)

### High Priority
- [ ] Fix status indicator not updating when switching modes mid-request (Issue #2)
- [ ] Add unit tests for `PlanManager`
- [ ] Add unit tests for `PlanValidator`
- [ ] Add tests for `isToolAllowedInPlanMode()`
- [ ] Add path traversal test cases (Issue #5)

### Medium Priority
- [ ] Review race condition risks in mode context (Issue #4)
- [ ] Fix "Formulating Plan" bottom margin (Issue #9)
- [ ] Fix message rendering order delay (Issue #10)
- [ ] Fix Escape cancel behavior (Issue #11)
- [ ] Add timeout/cleanup for exit-plan-mode prompts (Issue #17)

### Low Priority (UX Polish)
- [ ] Add theme support to question prompt UI (Issue #12)
- [ ] Consider "Plan Stage" vs "Plan Mode" label (Issue #13)
- [ ] Deduplicate slug generator word lists (Issue #15)

---

## Conclusion

The feature is well-designed with thoughtful architecture and good security considerations. However, **the interactive question system is fundamentally broken** - questions don't block execution, multi-select doesn't work, and "Other" input is non-functional. Combined with the command handling bug and lack of test coverage, this PR cannot be merged in its current state.

**Key blockers:**
1. `ask_user_question` tool returns immediately without waiting for answers
2. Multi-select questions cannot be advanced (stuck at 3/4)
3. Commands in plan mode trigger planning instead of executing

**Recommended action:** Fix the interactive question system architecture first, then address the other bugs before re-review. The question tool needs to return a Promise that awaits user input.
