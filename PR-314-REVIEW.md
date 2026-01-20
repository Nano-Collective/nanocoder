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

## 🟡 Moderate Issues

### 5. Callback Leak in Interactive Question Prompt

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

### 6. Duplicate Entries in Word Lists

**Severity: Low**
**File:** `source/utils/plan/slug-generator.ts`

There are duplicate entries in the word lists:
- `ADJECTIVES`: "careful" appears twice, "organized" appears twice, "inquisitive" appears twice, "analytical" appears twice
- `VERBS`: "extending" appears twice
- `NOUNS`: "module" appears twice, "handler" appears twice

**Recommendation:** Deduplicate the word lists.

---

### 7. Potential Non-Unique Summary After Loop

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

### 8. Missing Timeout in Exit Plan Mode

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

### 9. Type Safety for Tool Arguments
Several places use type assertions or `any` for tool arguments. Consider using discriminated unions or zod schemas for runtime validation.

### 10. Consider Debouncing `useInput` Handlers
The keyboard navigation could benefit from debouncing to prevent rapid key presses from causing issues.

### 11. Atomic File Writes Consistency
`plan-manager.ts` implements atomic writes for documents via temp file + rename, but `generateInitialProposalContent` writes directly. Consider using atomic writes consistently.

### 12. Consider Splitting the PR
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

## Checklist Before Merge

- [ ] Fix command execution bug in plan mode
- [ ] Fix status indicator not updating when switching modes mid-request
- [ ] Add unit tests for `PlanManager`
- [ ] Add unit tests for `PlanValidator`
- [ ] Add tests for `isToolAllowedInPlanMode()`
- [ ] Add path traversal test cases
- [ ] Deduplicate slug generator word lists
- [ ] Review race condition risks in mode context
- [ ] Add timeout/cleanup for exit-plan-mode prompts

---

## Conclusion

The feature is well-designed with thoughtful architecture and good security considerations. However, the critical bug with command handling in plan mode, combined with the lack of test coverage for security-critical code paths, means this PR should not be merged in its current state.

**Recommended action:** Address the command handling bug and add minimum test coverage before re-review.
