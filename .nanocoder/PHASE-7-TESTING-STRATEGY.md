# Phase 7: ToolManager Migration Testing Strategy

## Overview

This document outlines comprehensive testing strategies for Phase 7 (ToolManager migration to use ToolRegistry internally). Testing is critical to ensure backward compatibility and zero functionality loss.

**Test Scope:** Unit, integration, and end-to-end testing  
**Risk Level:** Low (backward compatible changes)  
**Coverage Target:** 100% of modified code paths  

## Test Organization

### Test File Structure

```
source/tools/
├── tool-manager.ts (modified)
├── tool-manager.spec.ts (existing)
├── __tests__/
│   ├── tool-manager-migration.spec.ts (new - Phase 7 specific)
│   ├── tool-manager-registry-integration.spec.ts (new - integration tests)
│   └── tool-manager-mcp-integration.spec.ts (existing, update if needed)
```

## Unit Tests

### 1. ToolManager Constructor Tests

```typescript
describe('ToolManager', () => {
  describe('constructor', () => {
    it('should initialize with empty ToolRegistry when no static tools exist', () => {
      // Setup: Mock empty static registries
      // Action: Create new ToolManager
      // Assert: registry should be empty
    });

    it('should initialize registry with static tools from imports', () => {
      // Setup: Mock static tool registries with known tools
      // Action: Create new ToolManager
      // Assert: registry.getToolCount() should match expected count
      // Assert: registry.getToolNames() should include all static tools
    });

    it('should initialize with correct tool metadata', () => {
      // Setup: Mock static tools with handlers, formatters, validators
      // Action: Create new ToolManager
      // Assert: Each tool entry should have all metadata intact
      // Assert: registry.getEntry(toolName) should return complete ToolEntry
    });

    it('should maintain backward compatibility with old property access', () => {
      // Setup: Create ToolManager with static tools
      // Action: Access tools via old patterns
      // Assert: getToolRegistry() returns same data as registry.getHandlers()
      // Assert: getNativeToolsRegistry() returns same data as registry.getNativeTools()
    });
  });
});
```

### 2. Static Tool Access Tests

```typescript
describe('ToolManager - Static Tool Access', () => {
  let manager: ToolManager;

  beforeEach(() => {
    manager = new ToolManager();
  });

  describe('getToolHandler()', () => {
    it('should return handler for known static tool', () => {
      const handler = manager.getToolHandler('readFile');
      assert(handler !== undefined);
      assert(typeof handler === 'function');
    });

    it('should return undefined for unknown tool', () => {
      const handler = manager.getToolHandler('nonexistent');
      assert(handler === undefined);
    });

    it('should return same handler as registry.getHandler()', () => {
      const toolName = 'readFile';
      const oldWay = manager.getToolHandler(toolName);
      const newWay = manager['registry'].getHandler(toolName);
      assert(oldWay === newWay);
    });
  });

  describe('getToolFormatter()', () => {
    it('should return formatter for tool with formatter', () => {
      const formatter = manager.getToolFormatter('readFile');
      assert(formatter !== undefined);
      assert(typeof formatter === 'function');
    });

    it('should return undefined for tool without formatter', () => {
      // Setup: Tool with no formatter
      const formatter = manager.getToolFormatter('someToolWithoutFormatter');
      assert(formatter === undefined);
    });

    it('should return same formatter as registry.getFormatter()', () => {
      const toolName = 'readFile';
      const oldWay = manager.getToolFormatter(toolName);
      const newWay = manager['registry'].getFormatter(toolName);
      assert(oldWay === newWay);
    });
  });

  describe('getToolValidator()', () => {
    it('should return validator for tool with validator', () => {
      const validator = manager.getToolValidator('readFile');
      assert(validator !== undefined);
      assert(typeof validator === 'function');
    });

    it('should return undefined for tool without validator', () => {
      const validator = manager.getToolValidator('someToolWithoutValidator');
      assert(validator === undefined);
    });

    it('should return same validator as registry.getValidator()', () => {
      const toolName = 'readFile';
      const oldWay = manager.getToolValidator(toolName);
      const newWay = manager['registry'].getValidator(toolName);
      assert(oldWay === newWay);
    });
  });

  describe('getAllTools()', () => {
    it('should return all native tools for static tools only', () => {
      const tools = manager.getAllTools();
      assert(Object.keys(tools).length > 0);
    });

    it('should return same tools as registry.getNativeTools()', () => {
      const oldWay = manager.getAllTools();
      const newWay = manager['registry'].getNativeTools();
      assert(JSON.stringify(oldWay) === JSON.stringify(newWay));
    });

    it('should contain valid AISDKCoreTool objects', () => {
      const tools = manager.getAllTools();
      for (const [name, tool] of Object.entries(tools)) {
        assert(tool !== undefined);
        assert(typeof tool === 'object');
      }
    });
  });

  describe('hasTool()', () => {
    it('should return true for existing static tool', () => {
      assert(manager.hasTool('readFile') === true);
    });

    it('should return false for non-existing tool', () => {
      assert(manager.hasTool('nonexistent') === false);
    });

    it('should return same result as registry.hasTool()', () => {
      const toolName = 'readFile';
      const oldWay = manager.hasTool(toolName);
      const newWay = manager['registry'].hasTool(toolName);
      assert(oldWay === newWay);
    });
  });
});
```

### 3. MCP Tool Registration Tests

```typescript
describe('ToolManager - MCP Tool Registration', () => {
  let manager: ToolManager;
  let mockMCPClient: Partial<MCPClient>;

  beforeEach(() => {
    manager = new ToolManager();
    // Setup mock MCP client
    mockMCPClient = {
      connectToServers: async () => [],
      getNativeToolsRegistry: () => ({
        'mcp_tool_1': createMockAISDKTool('mcp_tool_1'),
        'mcp_tool_2': createMockAISDKTool('mcp_tool_2'),
      }),
      getToolEntries: () => [
        {
          name: 'mcp_tool_1',
          tool: createMockAISDKTool('mcp_tool_1'),
          handler: async () => 'result 1',
        },
        {
          name: 'mcp_tool_2',
          tool: createMockAISDKTool('mcp_tool_2'),
          handler: async () => 'result 2',
        },
      ],
      getToolMapping: () => new Map([
        ['mcp_tool_1', {serverName: 'server1'}],
        ['mcp_tool_2', {serverName: 'server2'}],
      ]),
      disconnect: async () => {},
      getConnectedServers: () => ['server1', 'server2'],
      getServerTools: () => [],
    };
  });

  describe('initializeMCP()', () => {
    it('should register MCP tools in registry', async () => {
      // Setup: Mock MCPClient
      // Action: Call initializeMCP with mock servers
      // Assert: registry should contain MCP tools
      // Assert: manager.hasTool('mcp_tool_1') === true
      // Assert: manager.hasTool('mcp_tool_2') === true
    });

    it('should preserve static tools after MCP initialization', async () => {
      // Setup: Get initial static tool count
      // Action: Call initializeMCP
      // Assert: Static tools still exist
      // Assert: manager.hasTool('readFile') === true
    });

    it('should merge MCP tools with static tools in native registry', async () => {
      // Setup: Get static tool count
      // Action: Call initializeMCP with 2 MCP tools
      // Assert: getAllTools() should contain both static and MCP tools
      // Assert: getAllTools() count should be static count + 2
    });

    it('should register MCP tool handlers correctly', async () => {
      // Setup: Mock MCP tools
      // Action: Call initializeMCP
      // Assert: Each MCP tool handler should be callable
      // Assert: Calling handler should invoke mcpClient.callTool()
    });

    it('should store MCP tool entry metadata', async () => {
      // Setup: Mock MCP tools with metadata
      // Action: Call initializeMCP
      // Assert: registry.getEntry('mcp_tool_1') should have all metadata
      // Assert: getToolFormatter('mcp_tool_1') should return formatter if present
      // Assert: getToolValidator('mcp_tool_1') should return validator if present
    });
  });

  describe('disconnectMCP()', () => {
    it('should remove all MCP tools from registry', async () => {
      // Setup: Initialize MCP
      // Action: Call disconnectMCP()
      // Assert: manager.hasTool('mcp_tool_1') === false
      // Assert: manager.hasTool('mcp_tool_2') === false
    });

    it('should preserve static tools after MCP disconnect', async () => {
      // Setup: Initialize MCP
      // Action: Call disconnectMCP()
      // Assert: manager.hasTool('readFile') === true
      // Assert: Static tools count should be unchanged
    });

    it('should reset native tools registry to static only', async () => {
      // Setup: Initialize MCP, get tool count
      // Action: Call disconnectMCP()
      // Assert: getAllTools() count should equal static tools count
    });

    it('should clear MCP client reference', async () => {
      // Setup: Initialize MCP
      // Action: Call disconnectMCP()
      // Assert: manager['mcpClient'] should be null
    });
  });

  describe('getMCPToolInfo()', () => {
    it('should return MCP tool info for registered MCP tool', async () => {
      // Setup: Initialize MCP
      // Action: Call getMCPToolInfo('mcp_tool_1')
      // Assert: Result should have isMCPTool: true
      // Assert: Result should have serverName: 'server1'
    });

    it('should return non-MCP info for static tool', async () => {
      // Setup: Initialize MCP
      // Action: Call getMCPToolInfo('readFile')
      // Assert: Result should have isMCPTool: false
      // Assert: Result should not have serverName
    });

    it('should return non-MCP info when no MCP client', () => {
      // Setup: Don't initialize MCP
      // Action: Call getMCPToolInfo('any_tool')
      // Assert: Result should have isMCPTool: false
    });
  });
});
```

### 4. Registry Direct Access Tests

```typescript
describe('ToolManager - Registry Direct Access', () => {
  let manager: ToolManager;

  beforeEach(() => {
    manager = new ToolManager();
  });

  describe('getToolRegistry() backward compatibility', () => {
    it('should return all handlers as record', () => {
      const handlers = manager.getToolRegistry();
      assert(typeof handlers === 'object');
      assert('readFile' in handlers);
    });

    it('should return handlers in same format as before', () => {
      const handlers = manager.getToolRegistry();
      const handler = handlers['readFile'];
      assert(typeof handler === 'function');
    });

    it('should reflect changes to registry', async () => {
      // Setup: Initialize MCP with one tool
      // Action: Get registry before and after
      // Assert: After initialization, registry should have additional tools
    });
  });

  describe('getNativeToolsRegistry() backward compatibility', () => {
    it('should return all native tools as record', () => {
      const tools = manager.getNativeToolsRegistry();
      assert(typeof tools === 'object');
      assert('readFile' in tools);
    });

    it('should return same tools as getAllTools()', () => {
      const fromGetter = manager.getNativeToolsRegistry();
      const fromAlias = manager.getAllTools();
      assert(JSON.stringify(fromGetter) === JSON.stringify(fromAlias));
    });
  });
});
```

## Integration Tests

### 5. Tool Execution Flow Tests

```typescript
describe('ToolManager - Integration: Tool Execution Flow', () => {
  let manager: ToolManager;

  beforeEach(() => {
    manager = new ToolManager();
  });

  it('should support complete tool execution workflow', async () => {
    // Setup: Get handler and validator
    const handler = manager.getToolHandler('readFile');
    const validator = manager.getToolValidator('readFile');
    const tool = manager['registry'].getTool('readFile');

    // Action: Validate and execute
    const validationResult = await validator?.({path: 'test.txt'});
    assert(validationResult?.valid === true);

    // Execute handler
    const result = await handler?.({path: 'package.json'});
    assert(typeof result === 'string');
  });

  it('should support tool discovery workflow', () => {
    // Setup: Get all tool names
    const toolNames = manager['registry'].getToolNames();

    // Action: For each tool, verify complete metadata
    for (const toolName of toolNames) {
      const entry = manager['registry'].getEntry(toolName);
      assert(entry !== undefined);
      assert(entry.name === toolName);
      assert(entry.handler !== undefined);
      assert(entry.tool !== undefined);
    }
  });

  it('should support AI SDK integration workflow', () => {
    // Setup: Get all native tools for AI SDK
    const nativeTools = manager.getAllTools();

    // Action: Verify format for AI SDK
    for (const [name, tool] of Object.entries(nativeTools)) {
      assert(tool !== undefined);
      assert(typeof tool === 'object');
    }

    // Could pass to AI SDK now
    // const response = await generateText({
    //   tools: nativeTools,
    //   // ...
    // });
  });
});
```

### 6. MCP Lifecycle Integration Tests

```typescript
describe('ToolManager - Integration: MCP Lifecycle', () => {
  let manager: ToolManager;

  it('should handle complete MCP lifecycle', async () => {
    // Setup: Create manager
    manager = new ToolManager();
    const initialCount = manager['registry'].getToolCount();

    // Action: Initialize MCP with 2 tools
    // Assert: Tool count increases
    // Assert: Both tools accessible via all methods

    // Action: Get AI SDK tools
    // Assert: Can pass to AI SDK

    // Action: Execute MCP tool
    // Assert: Execution works correctly

    // Action: Disconnect MCP
    // Assert: MCP tools removed
    // Assert: Tool count back to initial

    // Action: Verify static tools still work
    // Assert: Can execute static tools
  });
});
```

## Backward Compatibility Tests

### 7. Legacy API Tests

```typescript
describe('ToolManager - Backward Compatibility', () => {
  let manager: ToolManager;

  beforeEach(() => {
    manager = new ToolManager();
  });

  it('should support all existing public methods', () => {
    // Verify all methods still exist and work
    assert(typeof manager.getAllTools === 'function');
    assert(typeof manager.getToolRegistry === 'function');
    assert(typeof manager.getToolHandler === 'function');
    assert(typeof manager.getToolFormatter === 'function');
    assert(typeof manager.getToolValidator === 'function');
    assert(typeof manager.getNativeToolsRegistry === 'function');
    assert(typeof manager.hasTool === 'function');
    assert(typeof manager.getMCPToolInfo === 'function');
    assert(typeof manager.getConnectedServers === 'function');
    assert(typeof manager.getServerTools === 'function');
    assert(typeof manager.initializeMCP === 'function');
    assert(typeof manager.disconnectMCP === 'function');
  });

  it('should return same data types as before', () => {
    // getAllTools returns Record<string, AISDKCoreTool>
    const tools = manager.getAllTools();
    assert(typeof tools === 'object');
    assert(!Array.isArray(tools));

    // getToolRegistry returns Record<string, ToolHandler>
    const handlers = manager.getToolRegistry();
    assert(typeof handlers === 'object');
    assert(!Array.isArray(handlers));

    // getToolHandler returns ToolHandler | undefined
    const handler = manager.getToolHandler('readFile');
    assert(handler === undefined || typeof handler === 'function');

    // hasTool returns boolean
    assert(typeof manager.hasTool('readFile') === 'boolean');
  });

  it('should maintain method signatures', () => {
    // Test with expected argument types
    assert(manager.getToolHandler('string') === undefined || typeof manager.getToolHandler('string') === 'function');
    assert(typeof manager.hasTool('string') === 'boolean');
    assert(manager.getMCPToolInfo('string').isMCPTool === false);
  });
});
```

## Performance Tests

### 8. Performance Baseline Tests

```typescript
describe('ToolManager - Performance', () => {
  let manager: ToolManager;

  beforeEach(() => {
    manager = new ToolManager();
  });

  it('should access tools with consistent performance', () => {
    const iterations = 10000;
    const startTime = performance.now();

    for (let i = 0; i < iterations; i++) {
      manager.getToolHandler('readFile');
      manager.getToolFormatter('readFile');
      manager.getToolValidator('readFile');
    }

    const duration = performance.now() - startTime;
    const avgTime = duration / iterations;

    // Average lookup should be < 0.1ms
    assert(avgTime < 0.1);
    console.log(`Average lookup time: ${avgTime.toFixed(4)}ms`);
  });

  it('should handle large tool sets efficiently', () => {
    // If static tools grow significantly, verify performance
    const toolCount = manager['registry'].getToolCount();
    const startTime = performance.now();

    // Get all tools
    manager.getAllTools();

    const duration = performance.now() - startTime;

    // Should be fast even with many tools
    assert(duration < 50); // Should complete in under 50ms
    console.log(`getAllTools() for ${toolCount} tools: ${duration.toFixed(2)}ms`);
  });
});
```

## End-to-End Tests

### 9. E2E Workflow Tests

```typescript
describe('ToolManager - E2E Workflows', () => {
  let manager: ToolManager;

  beforeEach(() => {
    manager = new ToolManager();
  });

  it('should support developer tool lookup and execution workflow', async () => {
    // 1. Discover tools
    const allTools = manager.getAllTools();
    const toolName = Object.keys(allTools)[0];

    // 2. Get tool metadata
    const entry = manager['registry'].getEntry(toolName);
    assert(entry !== undefined);

    // 3. Validate arguments
    const validator = manager.getToolValidator(toolName);
    if (validator) {
      const validation = await validator({});
      // Expect validation (may fail for empty args, that's OK)
    }

    // 4. Get formatter for display
    const formatter = manager.getToolFormatter(toolName);
    if (formatter) {
      const display = await formatter({});
      assert(typeof display === 'string' || display instanceof React.Component);
    }

    // 5. Execute handler
    const handler = manager.getToolHandler(toolName);
    if (handler) {
      // Note: Some tools may fail with empty args, that's OK for E2E
      try {
        await handler({});
      } catch (e) {
        // Expected for tools that require specific arguments
      }
    }
  });

  it('should support AI SDK integration workflow', () => {
    // 1. Get native tools for AI SDK
    const nativeTools = manager.getAllTools();

    // 2. Verify format
    for (const [name, tool] of Object.entries(nativeTools)) {
      assert(tool !== undefined);
    }

    // 3. Would pass to generateText
    // const response = await generateText({
    //   model: 'gpt-4',
    //   tools: nativeTools,
    //   messages: [...],
    // });

    // 4. Get handler for tool result
    // for (const toolCall of response.toolCalls) {
    //   const handler = manager.getToolHandler(toolCall.toolName);
    //   const result = await handler(toolCall.args);
    // }
  });
});
```

## Migration-Specific Tests

### 10. Registry vs Manual Tests

```typescript
describe('ToolManager - Migration Verification', () => {
  let manager: ToolManager;

  beforeEach(() => {
    manager = new ToolManager();
  });

  it('should produce identical results using registry vs manual access', () => {
    const toolNames = manager['registry'].getToolNames();

    for (const toolName of toolNames) {
      // Via registry
      const entryViaRegistry = manager['registry'].getEntry(toolName);
      const handlerViaRegistry = manager['registry'].getHandler(toolName);
      const formatterViaRegistry = manager['registry'].getFormatter(toolName);
      const validatorViaRegistry = manager['registry'].getValidator(toolName);
      const toolViaRegistry = manager['registry'].getTool(toolName);

      // Via public methods
      const handlerViaMethod = manager.getToolHandler(toolName);
      const formatterViaMethod = manager.getToolFormatter(toolName);
      const validatorViaMethod = manager.getToolValidator(toolName);

      // Verify they're the same
      assert(handlerViaRegistry === handlerViaMethod);
      assert(formatterViaRegistry === formatterViaMethod);
      assert(validatorViaRegistry === validatorViaMethod);
      assert(entryViaRegistry !== undefined);
      assert(toolViaRegistry !== undefined);
    }
  });

  it('should maintain internal registry consistency', () => {
    const allNames = manager['registry'].getToolNames();
    const allEntries = manager['registry'].getAllEntries();
    const handlers = manager['registry'].getHandlers();
    const tools = manager['registry'].getNativeTools();

    // All names should have entries
    for (const name of allNames) {
      assert(manager['registry'].hasTool(name) === true);
    }

    // All entries should be in allEntries
    for (const entry of allEntries) {
      assert(allNames.includes(entry.name));
    }

    // handlers and tools should match names
    assert(Object.keys(handlers).length === allNames.length);
    assert(Object.keys(tools).length === allNames.length);
  });
});
```

## Test Execution Plan

### Running Tests

```bash
# Run all tool manager tests
pnpm test source/tools/tool-manager.spec.ts

# Run Phase 7 specific tests
pnpm test source/tools/__tests__/tool-manager-migration.spec.ts

# Run integration tests
pnpm test source/tools/__tests__/tool-manager-registry-integration.spec.ts

# Run all tests with coverage
pnpm test:all --coverage

# Run tests in watch mode during development
pnpm test:watch source/tools/
```

### Coverage Requirements

| Area | Target | Notes |
|------|--------|-------|
| ToolManager methods | 100% | All public methods |
| Static tool paths | 100% | Initialization and access |
| MCP integration | 100% | Initialize and disconnect |
| Registry delegation | 100% | All delegated methods |
| Error handling | 95%+ | Exception cases |
| Overall | 95%+ | Tool system critical |

## Regression Test Checklist

### Before Migration
- [ ] Run full test suite: `pnpm test:all` ✓ All tests pass
- [ ] Record baseline metrics (coverage, test time)
- [ ] Verify all existing tests still pass

### After Migration Step 1 (Constructor)
- [ ] Constructor tests pass
- [ ] Static tool access tests pass
- [ ] All existing tests still pass

### After Migration Step 2 (MCP Methods)
- [ ] MCP initialization tests pass
- [ ] MCP disconnection tests pass
- [ ] All existing tests still pass

### After Migration Step 3 (Cleanup)
- [ ] Backward compatibility tests pass
- [ ] All existing tests still pass
- [ ] Coverage meets target

### Final Verification
- [ ] E2E workflow tests pass
- [ ] Performance tests pass (no degradation)
- [ ] Full test suite passes
- [ ] Coverage >= 95%
- [ ] No regressions detected

## Manual Testing Checklist

### Static Tools
- [ ] Can read files: `readFile`
- [ ] Can write files: `writeFile`
- [ ] Can create files: `createFile`
- [ ] Can search files: `searchFiles`
- [ ] Can fetch URLs: `fetchUrl`
- [ ] Can execute bash: `executeBash`
- [ ] Tool metadata accessible (formatter, validator)

### MCP Integration (if configured)
- [ ] MCP tools initialize correctly
- [ ] MCP tools execute correctly
- [ ] MCP tools disconnect cleanly
- [ ] Can switch between MCP servers
- [ ] Tool info correctly identifies MCP tools

### AI SDK Integration
- [ ] Can get all native tools
- [ ] Tools pass to `generateText()`
- [ ] Tools pass to `streamText()`
- [ ] Tool calls resolve correctly

## Success Criteria

- ✅ 100% backward compatibility (all existing code works)
- ✅ All unit tests pass (100% coverage of modified code)
- ✅ All integration tests pass
- ✅ E2E workflows complete successfully
- ✅ No performance degradation
- ✅ No regressions in existing functionality
- ✅ MCP integration still works correctly
- ✅ Registry properly encapsulates tool data

## Troubleshooting Guide

### Issue: Tests fail with "registry is undefined"
**Solution:** Ensure ToolRegistry is imported and initialized in constructor

### Issue: MCP tools not found after migration
**Solution:** Verify that `getToolEntries()` is called and entries are registered via `registry.registerMany()`

### Issue: Performance degradation
**Solution:** Check that registry uses Map (not object) for O(1) lookup

### Issue: Backward compatibility broken
**Solution:** Verify all old methods delegate to registry correctly

---

## Testing Timeline

**Phase 7 Timeline:**

1. **Day 1:** Implement Phase 7 Step 1 (Constructor) + Run unit tests
2. **Day 1-2:** Implement Phase 7 Step 2 (MCP Methods) + Run integration tests
3. **Day 2:** Implement Phase 7 Step 3 (Cleanup) + Run full suite
4. **Day 3:** Manual testing + E2E verification
5. **Day 3:** Deploy + Monitor for issues

---

_Phase 7: ToolManager Migration Testing Strategy_  
_Status: Ready for Implementation_  
_Risk Level: Low (Backward Compatible)_
