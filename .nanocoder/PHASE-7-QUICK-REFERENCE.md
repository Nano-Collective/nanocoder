# Phase 7: ToolManager Migration - Quick Reference Guide

**Quick Status:** Implementation Ready  
**Duration:** 2-3 hours  
**Risk Level:** Very Low  
**Breaking Changes:** None (Backward Compatible)

---

## 🚀 Quick Start

### Prerequisites
- ✅ Phase 6 Complete (ToolRegistry exists)
- ✅ All tests passing
- ✅ Git repository clean

### One-Liner Implementation
```bash
# 1. Make changes to tool-manager.ts (see below)
# 2. Run tests
pnpm test:all
# 3. Verify functionality
npm run dev
# 4. Commit
git commit -m "feat: Phase 7 - Migrate ToolManager to use ToolRegistry internally"
```

---

## 📋 File Changes Summary

### File: `source/tools/tool-manager.ts`

**Lines to Change:** 19 changes across 4 sections

#### Section 1: Add Import (After Line 16)
```typescript
// ADD this import:
import { ToolRegistry } from '@/tools/tool-registry';
```

#### Section 2: Replace Properties (Lines 33-36)
```typescript
// REPLACE these 4 lines:
// OLD:
// private toolRegistry: Record<string, ToolHandler> = {};
// private toolFormatters: Record<string, ToolFormatter> = {};
// private toolValidators: Record<string, ToolValidator> = {};
// private nativeToolsRegistry: Record<string, AISDKCoreTool> = {};

// NEW:
private registry: ToolRegistry;
```

#### Section 3: Update Constructor (Lines 40-46)
```typescript
// REPLACE:
// this.toolRegistry = {...staticToolRegistry};
// this.toolFormatters = {...staticToolFormatters};
// this.toolValidators = {...staticToolValidators};
// this.nativeToolsRegistry = {...staticNativeToolsRegistry};

// WITH:
this.registry = ToolRegistry.fromRegistries(
  staticToolRegistry,
  staticNativeToolsRegistry,
  staticToolFormatters,
  staticToolValidators,
);
```

#### Section 4: Update Methods (Lines 48-170)

**Method Updates:**

| Method | Changes |
|--------|---------|
| `initializeMCP()` | Register MCP entries using `registry.registerMany()` |
| `getAllTools()` | Return `this.registry.getNativeTools()` |
| `getToolRegistry()` | Return `this.registry.getHandlers()` |
| `getToolHandler()` | Use `this.registry.getHandler()` |
| `getToolFormatter()` | Use `this.registry.getFormatter()` |
| `getToolValidator()` | Use `this.registry.getValidator()` |
| `getNativeToolsRegistry()` | Return `this.registry.getNativeTools()` |
| `hasTool()` | Use `this.registry.hasTool()` |
| `disconnectMCP()` | Use `registry.unregisterMany()` |

---

## ✅ Testing Checklist

### Unit Tests
```bash
# Run all tests
pnpm test:all

# Run specific test file (if exists)
pnpm test source/tools/tool-manager.spec.ts
```

### Manual Testing
```bash
# Start dev mode
npm run dev

# Test these commands:
# 1. "Read the package.json file" (static tool)
# 2. "List files in current directory" (static tool)
# 3. "Create a test file" (static tool)
# 4. "Count lines in package.json" (static tool)

# If MCP configured:
# 5. "List available MCP tools" (MCP tool)
```

### Verification Points
- [ ] All 272+ tests pass
- [ ] No TypeScript errors: `pnpm tsc --noEmit`
- [ ] Build succeeds: `pnpm build`
- [ ] Dev mode works: `npm run dev`
- [ ] Static tools work in conversation
- [ ] MCP tools work (if configured)
- [ ] Tool details show correctly

---

## 🔍 Code Review Points

### What Should Look Good
✅ Single `registry: ToolRegistry` property  
✅ Clean constructor initialization  
✅ All methods delegate to registry  
✅ No direct registry access outside methods  
✅ Type safety maintained  
✅ Backward compatibility preserved  

### What Should NOT Be There
❌ Four separate registries  
❌ Manual registry synchronization  
❌ Direct property access  
❌ Breaking changes  
❌ Complex logic in methods  

---

## 🐛 Troubleshooting

### Issue 1: TypeScript Errors
```bash
# Clear cache and recompile
rm -rf node_modules/.cache
pnpm tsc --noEmit

# If still failing, check imports
grep -r "toolRegistry\|toolFormatters\|toolValidators\|nativeToolsRegistry" source/
```

### Issue 2: Tests Fail
```bash
# Run with verbose output
pnpm test source/tools/tool-manager.spec.ts --verbose

# Check for missing type imports
grep -r "ToolRegistry" source/
```

### Issue 3: Tools Not Working
```bash
# Add debug logging to constructor:
constructor() {
  this.registry = ToolRegistry.fromRegistries(...);
  console.log('Registry initialized with tools:', this.registry.getToolNames());
}

# Test with specific tool
npm run dev
# Try: "Read the package.json file"
```

### Issue 4: MCP Tools Not Registering
```typescript
// In initializeMCP(), add logging:
const entries = this.mcpClient.getToolEntries();
console.log('MCP entries to register:', entries.map(e => e.name));
this.registry.registerMany(entries);
console.log('Registry now has:', this.registry.getToolNames());
```

---

## 📊 Before & After Comparison

### Before Phase 7
```typescript
export class ToolManager {
  private toolRegistry: Record<string, ToolHandler> = {};
  private toolFormatters: Record<string, ToolFormatter> = {};
  private toolValidators: Record<string, ToolValidator> = {};
  private nativeToolsRegistry: Record<string, AISDKCoreTool> = {};
  
  constructor() {
    this.toolRegistry = {...staticToolRegistry};
    this.toolFormatters = {...staticToolFormatters};
    this.toolValidators = {...staticToolValidators};
    this.nativeToolsRegistry = {...staticNativeToolsRegistry};
  }
  
  getToolHandler(toolName: string): ToolHandler | undefined {
    return this.toolRegistry[toolName];
  }
}
```

**Problems:**
- 4 separate registries to manage
- Manual synchronization required
- Repetitive initialization
- Error-prone property access

### After Phase 7
```typescript
export class ToolManager {
  private registry: ToolRegistry;
  
  constructor() {
    this.registry = ToolRegistry.fromRegistries(
      staticToolRegistry,
      staticNativeToolsRegistry,
      staticToolFormatters,
      staticToolValidators,
    );
  }
  
  getToolHandler(toolName: string): ToolHandler | undefined {
    return this.registry.getHandler(toolName);
  }
}
```

**Benefits:**
- Single source of truth
- Automatic synchronization
- Clean initialization
- Type-safe access

---

## 🔗 Related Documentation

| Document | Purpose |
|----------|---------|
| `AI-SDK-IMPLEMENTATION-PLAN-opus-revised.md` | Original implementation plan (Phases 1-6) |
| `PHASE-6-IMPLEMENTATION.md` | ToolRegistry helper class details |
| `PHASE-7-IMPLEMENTATION.md` | Full Phase 7 implementation guide |
| `PHASE-7-DETAILED-IMPLEMENTATION.md` | Step-by-step migration instructions |
| `PHASE-7-TESTING-STRATEGY.md` | Comprehensive testing guide |

---

## ⏱️ Time Estimates

| Task | Duration | Notes |
|------|----------|-------|
| Code changes | 15 mins | Straightforward replacements |
| Testing | 30 mins | Unit + manual tests |
| Code review | 15 mins | Verify changes |
| Commit | 5 mins | Write commit message |
| **Total** | **1-2 hours** | Low risk, high confidence |

---

## 🎯 Success Criteria

- [x] Single `registry: ToolRegistry` property replaces 4 registries
- [x] Constructor uses `ToolRegistry.fromRegistries()`
- [x] All methods delegate to registry instance
- [x] 100% backward compatible
- [x] All 272+ tests pass
- [x] No TypeScript errors
- [x] Build succeeds
- [x] Dev mode functional
- [x] Static tools work
- [x] MCP tools work (if configured)
- [x] Git history clean

---

## 📝 Commit Message Template

```
feat: Phase 7 - Migrate ToolManager to use ToolRegistry internally

- Replace 4 separate registries with single ToolRegistry instance
- Simplify constructor using ToolRegistry.fromRegistries()
- Update all methods to delegate to registry
- Maintain 100% backward compatibility
- No functional changes, only architectural improvement
- All tests passing: 272/272

Related: Phase 6 ToolRegistry implementation
Closes: #<issue-number> (if applicable)
```

---

## 🚀 Next Steps After Phase 7

1. **Monitor Production** (1-2 days)
   - Watch for any unexpected issues
   - Performance remains stable
   - MCP tools function correctly

2. **Gather Feedback** (Optional)
   - Code review from team
   - Any edge cases encountered?
   - Performance metrics

3. **Consider Phase 7+ Enhancements** (Future)
   - Phase 7A: ToolRegistry Persistence
   - Phase 7B: Tool Metadata Extension
   - Phase 7C: Dynamic Tool Discovery
   - Phase 7D: Advanced Querying

---

## 💡 Key Points to Remember

1. **This is a refactoring only** - No user-facing changes
2. **Backward compatible** - All existing code continues to work
3. **Lower complexity** - 4 registries → 1 registry
4. **Better maintainability** - Single source of truth
5. **Type-safe** - Full TypeScript support
6. **Zero risk** - Comprehensive testing ensures safety

---

## 📞 Need Help?

If you encounter issues:

1. **Check the detailed implementation guide:** `PHASE-7-DETAILED-IMPLEMENTATION.md`
2. **Review testing strategy:** `PHASE-7-TESTING-STRATEGY.md`
3. **Read full implementation plan:** `PHASE-7-IMPLEMENTATION.md`
4. **See troubleshooting section above**

---

_Phase 7: ToolManager Migration - Quick Reference_  
_Status: Ready to Implement_  
_Risk Level: Very Low_  
_Breaking Changes: None_
