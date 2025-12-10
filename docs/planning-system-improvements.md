# Structured Task Planning System Improvements

## Goal

Make the planning system work effectively with **small models** (7B-14B parameters). Small models have limited context windows, weaker reasoning, and struggle with complex multi-step instructions. The system must compensate for these limitations through better architecture.

---

## Current System Analysis

### What Works

- Task decomposition via LLM
- Dependency tracking with topological sorting
- Context accumulation across tasks
- Event-driven status updates
- Basic task store operations (add/remove tasks exist but unused)

### Core Rigidity Issues

| Issue | Impact on Small Models |
|-------|----------------------|
| **Upfront planning** - Entire plan created before execution | Small models produce poor plans without seeing real data first |
| **Complex decomposition prompt** - 100+ line prompt asking for JSON | Overwhelms small models, causes malformed output |
| **Fragile context extraction** - Relies on specific markdown headers | Small models rarely format responses correctly |
| **No adaptive replanning** - Only skips blocked tasks | Can't recover when initial plan was wrong |
| **Sequential execution only** - No parallelism | Slower execution, no opportunity for small model to "check its work" |
| **Large context passed to tasks** - All discoveries, all decisions | Wastes precious context window on irrelevant info |

---

## Improvement Areas

### 1. Iterative Micro-Planning

**Problem**: Small models can't reliably plan 5-10 steps ahead without seeing actual code/data.

**Solution**: Plan only 1-2 tasks at a time, replan after each completion.

```
Current:  Plan[1,2,3,4,5] → Execute 1 → Execute 2 → ... → Done

Improved: Plan[1] → Execute 1 → Observe → Plan[2] → Execute 2 → ...
```

**Implementation**:

```typescript
// New config option
interface PlanningConfig {
  enabled: boolean;
  maxTasksPerPlan: number;
  planningStrategy: 'upfront' | 'iterative' | 'hybrid';
  lookAheadTasks: number; // For iterative: how many tasks to plan at once (1-3)
}

// Iterative planner
async function planNextTask(
  client: LLMClient,
  taskStore: TaskStore,
  originalGoal: string,
  completedContext: AccumulatedContext,
): Promise<TaskDefinition | null> {
  // Much simpler prompt - just asks "what's the single next step?"
  const prompt = buildNextStepPrompt(originalGoal, completedContext);
  // Returns null when goal is achieved
}
```

**Benefits for small models**:
- Simpler prompt ("what's next?") vs complex decomposition
- Decisions informed by actual discoveries
- Can course-correct after each step
- Smaller JSON output (1 task vs 5-10)

---

### 2. Simplified Task Schema

**Problem**: Current schema asks for too much upfront:
- title, description, acceptanceCriteria[], dependencies[], requiredTools[]

**Solution**: Minimal schema for small models, expand only when needed.

```typescript
// Minimal task for small models
interface SimpleTask {
  what: string;      // One sentence: what to do
  why: string;       // One sentence: why this helps achieve the goal
  tools: string[];   // Just tool names, no complex reasoning
}

// Full task (used internally, built from SimpleTask)
interface Task {
  id: string;
  title: string;           // Generated from 'what'
  description: string;     // Generated from 'what' + 'why'
  acceptanceCriteria: string[];  // Auto-generated or skipped
  // ... rest
}
```

**Decomposition prompt becomes**:

```
What is the next step to achieve: "${goal}"

So far we have:
${completedSummary}

Respond with JSON:
{"what": "read the config file", "why": "to find the database settings", "tools": ["read_file"]}
```

**Benefits**:
- 3 fields vs 5 fields
- Natural language vs structured criteria
- Fits in small model's working memory

---

### 3. Structured Output via Tools

**Problem**: `extractContextFromResponse()` parses markdown headers that small models don't reliably produce.

**Solution**: Use tool calls to capture structured data - small models handle tool calling better than free-form structure.

```typescript
// Define a "report_progress" tool
const reportProgressTool = {
  name: 'report_progress',
  description: 'Report what you learned and decided during this task',
  parameters: {
    type: 'object',
    properties: {
      summary: { type: 'string', description: 'One sentence summary of what was done' },
      learned: { type: 'array', items: { type: 'string' }, description: 'Key facts discovered' },
      decided: { type: 'array', items: { type: 'string' }, description: 'Decisions made' },
      done: { type: 'boolean', description: 'Is the task complete?' },
      next_hint: { type: 'string', description: 'Suggestion for what to do next' }
    },
    required: ['summary', 'done']
  }
};
```

**Execution loop**:
1. Task runs, model calls tools (read_file, etc.)
2. Model MUST call `report_progress` to signal completion
3. If model doesn't call it after N iterations, prompt: "Call report_progress to complete this task"

**Benefits**:
- Structured data guaranteed (it's a tool call, not free text)
- Small models are trained on tool calling
- Clear completion signal
- `next_hint` enables better iterative planning

---

### 4. Focused Context Windows

**Problem**: Current system passes all accumulated discoveries to every task, wasting context.

**Solution**: Intelligent context selection based on task needs.

```typescript
interface ContextSelector {
  // Select only relevant context for a task
  selectContext(
    task: Task,
    accumulated: AccumulatedContext,
    maxTokens: number,
  ): SelectedContext;
}

interface SelectedContext {
  // Most relevant discoveries (not all)
  relevantDiscoveries: string[];
  // Only summaries from direct dependencies
  dependencySummaries: string[];
  // File contents if task needs them (pre-loaded)
  preloadedFiles: FileContent[];
  // Estimated token count
  tokenEstimate: number;
}

// Selection strategies
type ContextStrategy =
  | 'minimal'      // Only direct dependency results
  | 'relevant'     // Keyword/embedding similarity matching
  | 'full';        // Everything (current behavior)
```

**Implementation ideas**:
- **Keyword matching**: If task mentions "config", include discoveries containing "config"
- **Recency bias**: Recent discoveries more likely relevant
- **File proximity**: If task touches `src/foo.ts`, include discoveries about `src/` files
- **Token budget**: Stop adding context when approaching limit

**Benefits**:
- More room for actual task work
- Less noise confusing the model
- Faster execution (less to process)

---

### 5. Graceful Degradation & Recovery

**Problem**: Current replanner only skips blocked tasks. No retry, no alternative approaches.

**Solution**: Multi-strategy recovery system.

```typescript
type RecoveryStrategy =
  | 'retry_same'           // Try exact same task again (transient errors)
  | 'retry_simplified'     // Simplify the task and retry
  | 'decompose_further'    // Break failed task into smaller steps
  | 'try_alternative'      // Different approach to same goal
  | 'skip_and_continue'    // Current behavior
  | 'ask_user'             // Pause for human input
  | 'abort';               // Give up on this branch

interface RecoveryDecision {
  strategy: RecoveryStrategy;
  newTasks?: TaskDefinition[];  // For decompose_further or try_alternative
  userQuestion?: string;         // For ask_user
  reason: string;
}

async function decideRecovery(
  failedTask: Task,
  error: string,
  attemptCount: number,
  context: AccumulatedContext,
): Promise<RecoveryDecision> {
  // Simple heuristics first (no LLM needed)
  if (isTransientError(error) && attemptCount < 2) {
    return { strategy: 'retry_same', reason: 'Transient error, retrying' };
  }

  if (error.includes('file not found') && attemptCount < 2) {
    return { strategy: 'retry_simplified', reason: 'File not found, will search first' };
  }

  // For complex failures, ask LLM for recovery plan
  // But with a SIMPLE prompt
  return await askLLMForRecovery(failedTask, error, context);
}
```

**Simple retry prompt**:

```
Task failed: "${task.title}"
Error: ${error}

What should we do?
A) Try again (maybe the error was temporary)
B) Try a different approach (describe it)
C) Skip this and continue with other tasks
D) Ask the user for help

Respond with just the letter and optionally a brief explanation.
```

**Benefits**:
- Multiple recovery options
- Simple decision prompt
- Graceful handling of small model mistakes
- User escape hatch for truly stuck situations

---

### 6. Task Templates for Common Patterns

**Problem**: Small models reinvent the wheel for common tasks (find file, read and summarize, modify code).

**Solution**: Pre-defined task templates that encode best practices.

```typescript
interface TaskTemplate {
  id: string;
  name: string;
  description: string;
  // Pattern to match user intent
  matchPatterns: RegExp[];
  // Pre-defined task structure
  createTasks: (params: Record<string, string>) => TaskDefinition[];
}

const templates: TaskTemplate[] = [
  {
    id: 'find_and_read',
    name: 'Find and Read File',
    description: 'Locate a file by name/pattern and read its contents',
    matchPatterns: [/find.*file/i, /locate.*file/i, /where is/i],
    createTasks: (params) => [
      {
        id: 'search',
        title: `Search for ${params.target}`,
        description: `Use search_files to find files matching "${params.target}"`,
        requiredTools: ['search_files'],
        dependencies: [],
        acceptanceCriteria: ['Found file path(s)'],
      },
      {
        id: 'read',
        title: 'Read file contents',
        description: 'Read the located file',
        requiredTools: ['read_file'],
        dependencies: ['search'],
        acceptanceCriteria: ['File contents retrieved'],
      },
    ],
  },
  {
    id: 'modify_code',
    name: 'Modify Code',
    description: 'Find, understand, and modify code',
    matchPatterns: [/change.*code/i, /modify/i, /update.*function/i, /fix.*bug/i],
    createTasks: (params) => [
      // 1. Find the code
      // 2. Read and understand it
      // 3. Plan the change
      // 4. Make the change
      // 5. Verify (if tests exist)
    ],
  },
];

// Template matching
function matchTemplate(query: string): TaskTemplate | null {
  for (const template of templates) {
    if (template.matchPatterns.some(p => p.test(query))) {
      return template;
    }
  }
  return null;
}
```

**Benefits**:
- Consistent execution for common tasks
- No LLM needed for planning well-known patterns
- Encodes "good practices" small models might miss
- Faster execution (skip decomposition step)

---

### 7. Verification Steps

**Problem**: Small models make mistakes but the system doesn't catch them.

**Solution**: Built-in verification after critical operations.

```typescript
interface VerificationConfig {
  // Auto-verify file modifications
  verifyFileChanges: boolean;
  // Run tests after code changes (if test command configured)
  runTestsAfterChanges: boolean;
  // Verify search results found something
  verifySearchResults: boolean;
  // Maximum verification attempts before continuing
  maxVerificationAttempts: number;
}

// After a file modification task completes:
async function verifyFileChange(
  task: Task,
  filePath: string,
  expectedChange: string,
): Promise<VerificationResult> {
  // Read the file
  const content = await readFile(filePath);

  // Simple check: does the expected content exist?
  const found = content.includes(expectedChange);

  if (!found) {
    return {
      passed: false,
      reason: `Expected change not found in ${filePath}`,
      suggestion: 'Re-read the file and verify the modification was applied correctly',
    };
  }

  return { passed: true };
}
```

**Verification task injection**:

```typescript
// After task completion, optionally inject verification task
function maybeAddVerificationTask(
  completedTask: Task,
  config: VerificationConfig,
): TaskDefinition | null {
  if (!config.verifyFileChanges) return null;

  const modifiedFiles = completedTask.context.filesModified;
  if (modifiedFiles.length === 0) return null;

  return {
    id: `verify-${completedTask.id}`,
    title: `Verify changes to ${modifiedFiles.join(', ')}`,
    description: 'Read modified files and confirm changes were applied correctly',
    requiredTools: ['read_file'],
    dependencies: [completedTask.id],
    acceptanceCriteria: ['All changes verified'],
  };
}
```

**Benefits**:
- Catches small model mistakes early
- Self-correcting behavior
- Builds confidence in results
- Optional (can disable for speed)

---

### 8. Conversation Checkpoints

**Problem**: No way to pause execution for user input mid-plan.

**Solution**: Checkpoint tasks that pause for confirmation or input.

```typescript
type TaskType = 'normal' | 'checkpoint' | 'decision';

interface CheckpointTask extends TaskDefinition {
  taskType: 'checkpoint';
  checkpointConfig: {
    message: string;           // What to show user
    options?: string[];        // Optional choices
    requireConfirmation: boolean;
  };
}

interface DecisionTask extends TaskDefinition {
  taskType: 'decision';
  decisionConfig: {
    question: string;
    options: Array<{
      label: string;
      description: string;
      nextTasks: TaskDefinition[];  // Tasks to add if this option chosen
    }>;
  };
}
```

**Example - Dangerous operation checkpoint**:

```typescript
const deleteCheckpoint: CheckpointTask = {
  id: 'confirm-delete',
  title: 'Confirm file deletion',
  description: 'Pause for user confirmation before deleting files',
  taskType: 'checkpoint',
  checkpointConfig: {
    message: 'About to delete the following files:\n- src/old-code.ts\n- src/deprecated.ts\n\nProceed?',
    options: ['Yes, delete them', 'No, skip this step', 'Let me review first'],
    requireConfirmation: true,
  },
  dependencies: ['identify-files-to-delete'],
  requiredTools: [],
  acceptanceCriteria: ['User confirmed'],
};
```

**Benefits**:
- Safety for destructive operations
- User can guide execution at key points
- Enables "human-in-the-loop" workflows
- Natural pause points for review

---

### 9. Streaming Progress & Partial Results

**Problem**: User sees nothing until task completes, then gets a wall of text.

**Solution**: Stream discoveries and progress as they happen.

```typescript
interface TaskProgress {
  taskId: string;
  phase: 'starting' | 'tool_calling' | 'processing' | 'completing';
  toolsUsed: string[];
  partialDiscoveries: string[];
  currentAction?: string;  // "Reading src/config.ts..."
  elapsedMs: number;
}

// Progress callback
type ProgressCallback = (progress: TaskProgress) => void;

// In executor
async function executeTask(
  // ... existing params
  onProgress?: ProgressCallback,
): Promise<TaskResult> {
  onProgress?.({
    taskId: task.id,
    phase: 'starting',
    toolsUsed: [],
    partialDiscoveries: [],
    elapsedMs: 0,
  });

  // During tool execution
  for (const toolCall of toolCalls) {
    onProgress?.({
      taskId: task.id,
      phase: 'tool_calling',
      currentAction: `Calling ${toolCall.function.name}...`,
      toolsUsed: [...usedTools, toolCall.function.name],
      partialDiscoveries: discoveries,
      elapsedMs: Date.now() - startTime,
    });

    // ... execute tool
  }
}
```

**UI update**:

```
┌─────────────────────────────────────────────┐
│ Task 2/5: Analyze configuration            │
│ ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ │
│ ⟳ Reading src/config.ts...                 │
│                                             │
│ Discovered so far:                          │
│  • Database configured for PostgreSQL       │
│  • Connection pooling enabled               │
│                                             │
│ Tools used: search_files, read_file         │
│ Elapsed: 3.2s                               │
└─────────────────────────────────────────────┘
```

**Benefits**:
- User knows system is working
- Early feedback if going wrong direction
- Partial results even if task fails
- Better UX for slow models

---

### 10. Model-Specific Adaptations

**Problem**: Same prompts/strategies used regardless of model capability.

**Solution**: Adapt system behavior based on detected model characteristics.

```typescript
interface ModelProfile {
  contextWindow: number;
  toolCallingReliability: 'high' | 'medium' | 'low';
  jsonReliability: 'high' | 'medium' | 'low';
  recommendedStrategy: 'upfront' | 'iterative';
  maxTasksPerPlan: number;
  needsSimplifiedPrompts: boolean;
  supportsStructuredOutput: boolean;
}

const modelProfiles: Record<string, Partial<ModelProfile>> = {
  // Large models - can handle complex planning
  'gpt-4': {
    toolCallingReliability: 'high',
    jsonReliability: 'high',
    recommendedStrategy: 'upfront',
    maxTasksPerPlan: 10,
    needsSimplifiedPrompts: false,
  },
  'claude-3-opus': {
    toolCallingReliability: 'high',
    jsonReliability: 'high',
    recommendedStrategy: 'upfront',
    maxTasksPerPlan: 10,
    needsSimplifiedPrompts: false,
  },

  // Medium models - hybrid approach
  'claude-3-sonnet': {
    toolCallingReliability: 'high',
    jsonReliability: 'medium',
    recommendedStrategy: 'hybrid',
    maxTasksPerPlan: 5,
    needsSimplifiedPrompts: false,
  },
  'llama-3-70b': {
    toolCallingReliability: 'medium',
    jsonReliability: 'medium',
    recommendedStrategy: 'hybrid',
    maxTasksPerPlan: 5,
    needsSimplifiedPrompts: true,
  },

  // Small models - iterative with simple prompts
  'llama-3-8b': {
    toolCallingReliability: 'low',
    jsonReliability: 'low',
    recommendedStrategy: 'iterative',
    maxTasksPerPlan: 2,
    needsSimplifiedPrompts: true,
  },
  'mistral-7b': {
    toolCallingReliability: 'low',
    jsonReliability: 'low',
    recommendedStrategy: 'iterative',
    maxTasksPerPlan: 2,
    needsSimplifiedPrompts: true,
  },
  'qwen-2.5-coder-7b': {
    toolCallingReliability: 'medium',
    jsonReliability: 'medium',
    recommendedStrategy: 'iterative',
    maxTasksPerPlan: 3,
    needsSimplifiedPrompts: true,
  },
};

// Runtime detection if profile not known
async function detectModelCapabilities(client: LLMClient): Promise<ModelProfile> {
  // Run simple calibration tests
  const jsonTest = await testJsonOutput(client);
  const toolTest = await testToolCalling(client);

  return {
    contextWindow: client.getContextSize(),
    toolCallingReliability: toolTest.score > 0.8 ? 'high' : toolTest.score > 0.5 ? 'medium' : 'low',
    jsonReliability: jsonTest.score > 0.8 ? 'high' : jsonTest.score > 0.5 ? 'medium' : 'low',
    // ... derive other settings
  };
}
```

**Prompt adaptation**:

```typescript
function buildDecompositionPrompt(
  query: string,
  profile: ModelProfile,
): string {
  if (profile.needsSimplifiedPrompts) {
    return buildSimpleDecompositionPrompt(query);  // Short, clear, few examples
  }
  return buildFullDecompositionPrompt(query);  // Current detailed prompt
}

function buildSimpleDecompositionPrompt(query: string): string {
  return `Break this task into 2-3 simple steps.

Task: ${query}

Respond with JSON array:
[{"what": "step description", "tools": ["tool_name"]}]

Example:
[{"what": "find the config file", "tools": ["search_files"]}, {"what": "read and summarize it", "tools": ["read_file"]}]

Your steps:`;
}
```

**Benefits**:
- Optimal behavior for each model tier
- Small models get simpler prompts
- Large models can use full capabilities
- Can auto-detect if model unknown

---

## Implementation Priority

### Phase 1: Foundation (High Impact, Moderate Effort)

1. **Iterative micro-planning** - Most impactful for small models
2. **Simplified task schema** - Reduces decomposition failures
3. **Structured output via tools** - Reliable context extraction

### Phase 2: Resilience (Medium Impact, Moderate Effort)

4. **Graceful degradation & recovery** - Handle inevitable failures
5. **Focused context windows** - Better use of limited context
6. **Streaming progress** - UX improvement

### Phase 3: Polish (Medium Impact, Higher Effort)

7. **Task templates** - Speed up common operations
8. **Verification steps** - Catch mistakes
9. **Model-specific adaptations** - Optimize per model

### Phase 4: Advanced (Lower Priority)

10. **Conversation checkpoints** - Human-in-the-loop
11. **Parallel task execution** - Performance (complex)

---

## Success Metrics

| Metric | Current | Target |
|--------|---------|--------|
| Task decomposition success rate (7B model) | ~40% | >80% |
| Context extraction success rate | ~30% | >90% |
| Multi-step task completion rate | ~25% | >60% |
| Average tasks per successful completion | 2-3 | 4-6 |
| User interventions required | High | Low |
| Recovery from failures | Rare | Common |

---

## Open Questions

1. **How much overhead does iterative planning add?** Each step requires an LLM call. Worth benchmarking upfront vs iterative for simple tasks.

2. **Should templates be user-extensible?** Could allow `.nanocoder/task-templates/` for custom patterns.

3. **What's the right verification granularity?** Too much verification slows things down, too little misses errors.

4. **How to handle very long tasks?** Some tasks legitimately need 10+ steps. Should we chunk them differently?

5. **Should we expose planning strategy to users?** `/planning iterative` vs `/planning upfront` vs `/planning auto`

---

## Related Files

- `source/agent/types.ts` - Core type definitions
- `source/agent/task-store.ts` - State management
- `source/agent/task-decomposer.ts` - LLM-based decomposition
- `source/agent/task-executor.ts` - Task execution
- `source/agent/replanner.ts` - Recovery logic (currently minimal)
- `source/hooks/usePlanningHandler.tsx` - React integration
- `source/components/task-plan-view.tsx` - Plan visualization
