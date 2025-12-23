# Dependency Injection Refactoring Analysis

> **Generated**: 2025-12-23
> **Status**: Technical Debt Analysis
> **Priority**: Medium-High
> **Estimated Effort**: 8-15 days total

## Executive Summary

This document analyzes the "Common Blocker Pattern" identified in the codebase where module-level singleton imports prevent effective unit testing without mocking libraries. The pattern affects **17+ files** across multiple subsystems and limits test coverage for critical execution paths.

---

## Table of Contents

1. [Pattern Description](#pattern-description)
2. [Confirmed Affected Files (from Issue)](#confirmed-affected-files-from-issue)
3. [Additional Files with Same Pattern](#additional-files-with-same-pattern)
4. [Singleton Registry](#singleton-registry)
5. [Refactoring Recommendations](#refactoring-recommendations)
6. [Implementation Priority](#implementation-priority)
7. [Proposed Solutions](#proposed-solutions)
8. [Estimated Impact](#estimated-impact)

---

## Pattern Description

### The Problem

Functions have hard-coded dependencies on singleton getters or dynamic imports that cannot be intercepted during unit testing:

```typescript
// BEFORE: Hard to test - singleton called at execution time
import { getVSCodeServer } from '@/vscode/index';

const executeGetDiagnostics = async (args) => {
    const server = getVSCodeServer();  // Cannot mock without sinon/vi.mock
    // ...
};
```

### Why This Matters

1. **Execution paths remain untested** - The core logic requires actual connections
2. **Low coverage on critical files** - Key files stuck at 20-62% coverage
3. **Integration tests are expensive** - Require full app context or mocking libraries
4. **Tight coupling** - Makes refactoring risky without comprehensive tests

---

## Confirmed Affected Files (from Issue)

### 1. `source/tools/lsp-get-diagnostics.tsx`

| Metric | Value |
|--------|-------|
| **Coverage** | 20.64% |
| **Blockers** | `getVSCodeServer()`, `getLSPManager()` |
| **Lines Affected** | 20, 102, 114 |

```typescript
// Line 20 - getVSCodeDiagnostics function
const server = getVSCodeServer();

// Line 102 - executeGetDiagnostics function
const server = getVSCodeServer();

// Line 114 - executeGetDiagnostics function
const lspManager = getLSPManager();
```

**What CAN be tested**: Formatter, `needsApproval`, severity formatting, VS Code format
**What CANNOT be tested**: `executeGetDiagnostics()`, `getVSCodeDiagnostics()`

---

### 2. `source/hooks/chat-handler/conversation/tool-executor.tsx`

| Metric | Value |
|--------|-------|
| **Coverage** | 62.38% |
| **Blockers** | Dynamic import `await import('@/message-handler')` |
| **Lines Affected** | 24 |

```typescript
// Line 24 - Dynamic import cannot be intercepted
const {processToolUse} = await import('@/message-handler');
```

**What CAN be tested**: Validation logic, error handling structure
**What CANNOT be tested**: Tool execution flow with actual `processToolUse`

---

### 3. `source/hooks/chat-handler/conversation/conversation-loop.tsx`

| Metric | Value |
|--------|-------|
| **Coverage** | 25.83% |
| **Blockers** | Imports `executeToolsDirectly` (which has dynamic import) |
| **Lines Affected** | 13, 395 |

```typescript
// Line 13 - Imports executor with dynamic import blocker
import {executeToolsDirectly} from './tool-executor';

// Line 395 - Calls blocked function
const directResults = await executeToolsDirectly(/* ... */);
```

**What CAN be tested**: Message parsing, tool call filtering, error handling
**What CANNOT be tested**: Full conversation loop with tool execution

---

## Additional Files with Same Pattern

### High Priority - Core Hooks & Commands

#### 4. `source/hooks/useToolHandler.tsx`

| Metric | Value |
|--------|-------|
| **Blockers** | `getVSCodeServer()`, `getToolManager()`, `processToolUse` |
| **Lines Affected** | 94, 146, 256, 296 |

```typescript
// Line 94 - getVSCodeServer() call
const vscodeServer = getVSCodeServer();

// Line 146 - getToolManager() call
const toolManager = getToolManager();

// Line 256 - processToolUse (imported from message-handler)
const result = await processToolUse(currentTool);

// Line 296 - Another getVSCodeServer() call
const vscodeServer = getVSCodeServer();
```

---

#### 5. `source/commands/lsp.tsx`

| Metric | Value |
|--------|-------|
| **Blockers** | `getLSPManager()` |
| **Lines Affected** | 108 |

```typescript
// Line 108 - Handler function
const lspManager = getLSPManager();
```

---

#### 6. `source/commands/checkpoint.tsx`

| Metric | Value |
|--------|-------|
| **Blockers** | `getDefaultCheckpointManager()`, dynamic import |
| **Lines Affected** | 69, 117, 144, 195, 287 |

```typescript
// Lines 69, 117, 144, 287 - Uses local singleton
const manager = getDefaultCheckpointManager();

// Line 195 - Dynamic import
const CheckpointSelector = (await import('@/components/checkpoint-selector')).default;
```

---

#### 7. `source/commands/usage.tsx`

| Metric | Value |
|--------|-------|
| **Blockers** | `getToolManager()` |
| **Lines Affected** | 38 |

```typescript
// Line 38
const toolManager = getToolManager();
```

---

#### 8. `source/commands/mcp.tsx`

| Metric | Value |
|--------|-------|
| **Blockers** | `getToolManager()` |
| **Lines Affected** | 153 |

```typescript
// Line 153
const toolManager = getToolManager();
```

---

### Medium Priority - Tools with Mode-Based Behavior

#### 9. `source/tools/string-replace.tsx`

| Metric | Value |
|--------|-------|
| **Blockers** | `getCurrentMode()`, `isVSCodeConnected()`, `sendFileChangeToVSCode()`, `closeDiffInVSCode()` |
| **Lines Affected** | 134, 427, 437, 455, 459 |

```typescript
// Line 134 - needsApproval function
const mode = getCurrentMode();

// Lines 427, 437, 455, 459 - VSCode integration
if (result === undefined && isVSCodeConnected()) { ... }
const changeId = sendFileChangeToVSCode(/* ... */);
closeDiffInVSCode(changeId);
```

---

#### 10. `source/tools/write-file.tsx`

| Metric | Value |
|--------|-------|
| **Blockers** | `getCurrentMode()`, `isVSCodeConnected()`, `sendFileChangeToVSCode()`, `closeDiffInVSCode()` |
| **Lines Affected** | 70, 162, 176, 189, 193 |

```typescript
// Line 70 - needsApproval function
const mode = getCurrentMode();

// Lines 162, 176, 189, 193 - VSCode integration
if (result === undefined && isVSCodeConnected()) { ... }
const changeId = sendFileChangeToVSCode(/* ... */);
closeDiffInVSCode(changeId);
```

---

### Medium Priority - Components & Other Hooks

#### 11. `source/components/tool-confirmation.tsx`

| Metric | Value |
|--------|-------|
| **Blockers** | `getToolManager()`, `getLogger()` |
| **Lines Affected** | 42, 68 |

```typescript
// Line 42
const toolManager = getToolManager();

// Line 68
const logger = getLogger();
```

---

#### 12. `source/hooks/useModeHandlers.tsx`

| Metric | Value |
|--------|-------|
| **Blockers** | `getToolManager()` |
| **Lines Affected** | 237 |

```typescript
// Line 237 (within reinitializeMCPServers callback)
const toolManager = getToolManager();
```

---

### Lower Priority - MCP & Logging

#### 13. `source/mcp/mcp-client.ts`

| Metric | Value |
|--------|-------|
| **Blockers** | `getCurrentMode()`, `getLogger()` (class member) |
| **Lines Affected** | 33, 312 |

```typescript
// Line 33 - Class member initialization
private logger = getLogger();

// Line 312 - Mode check in tool wrapper
const mode = getCurrentMode();
```

---

#### 14. `source/utils/message-queue.tsx`

| Metric | Value |
|--------|-------|
| **Blockers** | `getLogger()` (module-level) |
| **Lines Affected** | 27 |

```typescript
// Line 27 - Module-level logger
const logger = getLogger();
```

---

#### 15. `source/models/models-cache.ts`

| Metric | Value |
|--------|-------|
| **Blockers** | `getLogger()` |
| **Lines Affected** | 56, 75 |

```typescript
// Lines 56, 75 - Inside functions
const logger = getLogger();
```

---

#### 16. `source/models/models-dev-client.ts`

| Metric | Value |
|--------|-------|
| **Blockers** | `getLogger()` |
| **Lines Affected** | 190 |

```typescript
// Line 190
const logger = getLogger();
```

---

#### 17. `source/utils/file-autocomplete.ts`

| Metric | Value |
|--------|-------|
| **Blockers** | `getLogger()` |
| **Lines Affected** | 97 |

```typescript
// Line 97
const logger = getLogger();
```

---

## Singleton Registry

The following singletons are used across the codebase:

| Singleton | Source File | Instance Variable | Usage Count |
|-----------|-------------|-------------------|-------------|
| `getVSCodeServer()` | `source/vscode/vscode-server.ts:374` | `serverInstance` | 6 |
| `getLSPManager()` | `source/lsp/lsp-manager.ts:404` | `lspManagerInstance` | 4 |
| `getToolManager()` | `source/message-handler.ts:22` | `toolManagerGetter` | 7 |
| `getCurrentMode()` | `source/context/mode-context.ts:14` | `currentMode` | 4 |
| `getCurrentSession()` | `source/usage/tracker.ts:96` | `currentSessionTracker` | 1+ |
| `getLogger()` | `source/utils/logging/index.ts:19` | via `loggerProvider` | 15+ |
| `getDefaultCheckpointManager()` | `source/commands/checkpoint.tsx:20` | `defaultCheckpointManager` | 4 |

### Helper Functions Using Singletons Internally

These functions call `getVSCodeServer()` internally:

| Function | Source |
|----------|--------|
| `isVSCodeConnected()` | `source/vscode/vscode-server.ts:384` |
| `sendFileChangeToVSCode()` | `source/vscode/vscode-server.ts:392` |
| `closeDiffInVSCode()` | `source/vscode/vscode-server.ts:415` |
| `closeAllDiffsInVSCode()` | `source/vscode/vscode-server.ts` |

---

## Refactoring Recommendations

### Pattern 1: Dependency Injection via Function Parameters

Best for: Functions with clear entry points

```typescript
// BEFORE
import { getVSCodeServer } from '@/vscode/index';
import { getLSPManager } from '@/lsp/index';

const executeGetDiagnostics = async (args: GetDiagnosticsArgs): Promise<string> => {
    const server = getVSCodeServer();
    const lspManager = getLSPManager();
    // ...
};

// AFTER
interface DiagnosticsDependencies {
    vscodeServer?: VSCodeServer;
    lspManager?: LSPManager;
}

const executeGetDiagnostics = async (
    args: GetDiagnosticsArgs,
    deps: DiagnosticsDependencies = {}
): Promise<string> => {
    const server = deps.vscodeServer ?? getVSCodeServer();
    const lspManager = deps.lspManager ?? getLSPManager();
    // ...
};

// TEST
it('should handle no VS Code connection', async () => {
    const mockServer = { hasConnections: () => false };
    const mockLSP = { isInitialized: () => false };

    const result = await executeGetDiagnostics(
        { path: '/test.ts' },
        { vscodeServer: mockServer, lspManager: mockLSP }
    );

    expect(result).toContain('No diagnostics source available');
});
```

---

### Pattern 2: Dependency Injection via Props/Parameters

Best for: React hooks and components

```typescript
// BEFORE
export function useToolHandler({ /* props */ }: UseToolHandlerProps) {
    const handleToolConfirmation = (confirmed: boolean) => {
        const vscodeServer = getVSCodeServer();
        // ...
    };
}

// AFTER
interface UseToolHandlerProps {
    // ... existing props
    vscodeServer?: VSCodeServer;
    toolManager?: ToolManager;
}

export function useToolHandler({
    vscodeServer = getVSCodeServer(),
    toolManager = getToolManager(),
    /* other props */
}: UseToolHandlerProps) {
    const handleToolConfirmation = (confirmed: boolean) => {
        // Use injected vscodeServer
        // ...
    };
}
```

---

### Pattern 3: Factory Function for Commands

Best for: Command handlers with singleton dependencies

```typescript
// BEFORE
export const lspCommand: Command = {
    name: 'lsp',
    handler: (_args, _messages, _metadata) => {
        const lspManager = getLSPManager();
        // ...
    },
};

// AFTER
export function createLspCommand(
    deps: { lspManager?: LSPManager } = {}
): Command {
    return {
        name: 'lsp',
        handler: (_args, _messages, _metadata) => {
            const lspManager = deps.lspManager ?? getLSPManager();
            // ...
        },
    };
}

// Default export for production
export const lspCommand = createLspCommand();

// TEST
it('should display server status', async () => {
    const mockLSP = {
        getStatus: () => ({
            initialized: true,
            servers: [{ name: 'ts-server', ready: true, languages: ['ts'] }]
        })
    };

    const command = createLspCommand({ lspManager: mockLSP });
    const result = await command.handler([], [], {});
    // Assert on result
});
```

---

### Pattern 4: Context Provider for React Components

Best for: Components deeply nested that need singleton access

```typescript
// Create a context for dependencies
interface DependencyContextValue {
    vscodeServer: VSCodeServer;
    toolManager: ToolManager | null;
    logger: Logger;
}

const DependencyContext = React.createContext<DependencyContextValue | null>(null);

// Provider with real implementations
export function DependencyProvider({ children }: { children: React.ReactNode }) {
    const value = {
        vscodeServer: getVSCodeServer(),
        toolManager: getToolManager(),
        logger: getLogger(),
    };
    return (
        <DependencyContext.Provider value={value}>
            {children}
        </DependencyContext.Provider>
    );
}

// Test provider with mocks
export function TestDependencyProvider({
    children,
    mocks
}: {
    children: React.ReactNode;
    mocks: Partial<DependencyContextValue>;
}) {
    const value = {
        vscodeServer: mocks.vscodeServer ?? createMockVSCodeServer(),
        toolManager: mocks.toolManager ?? null,
        logger: mocks.logger ?? createMockLogger(),
    };
    return (
        <DependencyContext.Provider value={value}>
            {children}
        </DependencyContext.Provider>
    );
}
```

---

## Implementation Priority

### Phase 1: High-Impact Core Files (3-4 days)

| File | Effort | Coverage Gain |
|------|--------|---------------|
| `lsp-get-diagnostics.tsx` | 0.5 days | +15-20% |
| `tool-executor.tsx` | 0.5 days | +20-25% |
| `conversation-loop.tsx` | 1 day | +30-40% |
| `useToolHandler.tsx` | 1 day | +25-35% |

**Total Phase 1 Effort**: 3 days
**Expected Coverage Gain**: +3-5% overall

---

### Phase 2: Commands & Components (2-3 days)

| File | Effort | Coverage Gain |
|------|--------|---------------|
| `commands/lsp.tsx` | 0.25 days | +5-10% |
| `commands/checkpoint.tsx` | 0.5 days | +15-20% |
| `commands/usage.tsx` | 0.25 days | +10-15% |
| `commands/mcp.tsx` | 0.25 days | +10-15% |
| `components/tool-confirmation.tsx` | 0.5 days | +15-20% |
| `hooks/useModeHandlers.tsx` | 0.5 days | +10-15% |

**Total Phase 2 Effort**: 2.25 days
**Expected Coverage Gain**: +1-2% overall

---

### Phase 3: Tools & Mode Integration (2-3 days)

| File | Effort | Coverage Gain |
|------|--------|---------------|
| `tools/string-replace.tsx` | 0.75 days | +10-15% |
| `tools/write-file.tsx` | 0.75 days | +10-15% |
| `mcp/mcp-client.ts` | 0.75 days | +5-10% |

**Total Phase 3 Effort**: 2.25 days
**Expected Coverage Gain**: +1-1.5% overall

---

### Phase 4: Logging & Utilities (Optional, 1-2 days)

| File | Effort | Notes |
|------|--------|-------|
| `utils/message-queue.tsx` | 0.25 days | Low priority |
| `models/models-cache.ts` | 0.25 days | Low priority |
| `models/models-dev-client.ts` | 0.25 days | Low priority |
| `utils/file-autocomplete.ts` | 0.25 days | Low priority |

**Total Phase 4 Effort**: 1 day
**Note**: Logger DI provides minimal test coverage benefit

---

## Estimated Impact

### Summary Table

| Phase | Files | Effort | Coverage Gain | Priority |
|-------|-------|--------|---------------|----------|
| Phase 1 | 4 | 3 days | +3-5% | **High** |
| Phase 2 | 6 | 2.25 days | +1-2% | **Medium** |
| Phase 3 | 3 | 2.25 days | +1-1.5% | **Medium** |
| Phase 4 | 4 | 1 day | +0.5% | Low |
| **Total** | **17** | **8.5 days** | **+5.5-8.5%** | - |

### Benefits Beyond Coverage

1. **Better architecture** - Clear dependency graphs
2. **Easier refactoring** - Can swap implementations
3. **Faster tests** - No need for integration test overhead
4. **Better documentation** - Dependencies are explicit in signatures
5. **Reduced coupling** - Files become more modular

---

## Quick Wins (Can Do Without Full Refactor)

### 1. Export Reset Functions for Testing

Already exists for `LSPManager`:

```typescript
// source/lsp/lsp-manager.ts:414
export async function resetLSPManager(): Promise<void> {
    if (lspManagerInstance) {
        await lspManagerInstance.shutdown();
        lspManagerInstance = null;
    }
}
```

Add similar for other singletons:

```typescript
// Add to vscode-server.ts
export function resetVSCodeServer(): void {
    if (serverInstance) {
        serverInstance.shutdown();
        serverInstance = null;
    }
}

// Add to message-handler.ts
export function resetToolManager(): void {
    toolManagerGetter = null;
}
```

### 2. Create Mock Factories

```typescript
// source/test-utils/mocks.ts
export function createMockVSCodeServer(overrides = {}) {
    return {
        hasConnections: () => false,
        onCallbacks: () => {},
        requestDiagnostics: () => {},
        closeAllDiffs: () => {},
        ...overrides,
    };
}

export function createMockLSPManager(overrides = {}) {
    return {
        isInitialized: () => false,
        hasLanguageSupport: () => false,
        getDiagnostics: async () => [],
        getAllDiagnostics: () => [],
        ...overrides,
    };
}
```

---

## Appendix: Files Summary

| # | File | Singletons Used | Priority |
|---|------|----------------|----------|
| 1 | `tools/lsp-get-diagnostics.tsx` | VSCode, LSP | High |
| 2 | `hooks/chat-handler/conversation/tool-executor.tsx` | Dynamic Import | High |
| 3 | `hooks/chat-handler/conversation/conversation-loop.tsx` | (via tool-executor) | High |
| 4 | `hooks/useToolHandler.tsx` | VSCode, ToolManager | High |
| 5 | `commands/lsp.tsx` | LSP | Medium |
| 6 | `commands/checkpoint.tsx` | Checkpoint, Dynamic | Medium |
| 7 | `commands/usage.tsx` | ToolManager | Medium |
| 8 | `commands/mcp.tsx` | ToolManager | Medium |
| 9 | `tools/string-replace.tsx` | Mode, VSCode helpers | Medium |
| 10 | `tools/write-file.tsx` | Mode, VSCode helpers | Medium |
| 11 | `components/tool-confirmation.tsx` | ToolManager, Logger | Medium |
| 12 | `hooks/useModeHandlers.tsx` | ToolManager | Medium |
| 13 | `mcp/mcp-client.ts` | Mode, Logger | Medium |
| 14 | `utils/message-queue.tsx` | Logger | Low |
| 15 | `models/models-cache.ts` | Logger | Low |
| 16 | `models/models-dev-client.ts` | Logger | Low |
| 17 | `utils/file-autocomplete.ts` | Logger | Low |

---

## Conclusion

The dependency injection refactoring is a worthwhile investment that will:

1. **Improve test coverage by 5-8%** with focused effort
2. **Enable proper unit testing** of core execution paths
3. **Reduce reliance on integration tests** which are slower and more complex
4. **Create better architecture** with explicit dependencies

**Recommended approach**: Start with Phase 1 (high-impact core files) and evaluate ROI before proceeding to other phases.
