/**
 * Plan Mode AI Prompts
 *
 * Provides mode-specific instructions for the 5-phase plan workflow.
 * These prompts are injected into the system message when plan mode is active.
 */

import type {PlanPhase} from '@/types/core';
import type {DocumentType} from '@/types/templates';

/**
 * Get the plan mode instructions for the given phase
 *
 * @param phase - Current workflow phase
 * @param planSummary - Active plan summary (directory name)
 * @param currentDocument - The document currently being worked on
 * @returns Plan mode instructions string
 */
export function getPlanModePrompt(
	phase: PlanPhase,
	planSummary: string,
	currentDocument: DocumentType | null = null,
): string {
	const baseInstructions = `# Plan Mode Active

You are in **Plan Mode** - a structured planning workflow for thoughtful code changes.

**Current Plan:** \`${planSummary}\`
**Current Phase:** ${getPhaseLabel(phase)}
${currentDocument ? `**Current Document:** ${getDocumentLabel(currentDocument)}` : ''}

## Overview

Plan Mode follows a 5-phase workflow. Phase transitions happen **AUTOMATICALLY** - you do NOT need to ask for user approval to move between phases:

1. **Understanding** → Creates \`proposal.md\` (Why, what changes, impact)
2. **Design** → Creates \`design.md\` (Technical decisions with interactive Q&A)
3. **Review** → Creates \`spec.md\` (Requirements with Gherkin scenarios)
4. **Final Plan** → Creates \`tasks.md\` + \`plan.md\` (Task list + consolidated view)
5. **Exit** → Final validation + user approval

**Important:** All phase transitions are automatic. Only the FINAL PLAN presented in the Exit phase requires user review and approval.

## Continuous Workflow

**CRITICAL:** This is a **continuous autonomous workflow**. After each phase:
1. Complete the required document for that phase
2. State the transition phrase to move to the next phase
3. **DO NOT STOP** - continue immediately to the next phase
4. The conversation will continue automatically until you call \`exit-plan-mode\`

**Do NOT:**
- Stop and wait for user input between phases (except when using \`ask_user_question\` tool)
- Ask "Should I continue?" or similar questions
- Present intermediate results for approval
- Add filler text like "Let me know if you want me to proceed"

**DO:**
- Move through all 5 phases continuously
- Only use \`ask_user_question\` when you need user input for decisions
- Create all required documents (proposal.md, design.md, spec.md, tasks.md, plan.md)
- Call \`exit-plan-mode\` when all documents are complete

## Multi-Document Structure

Plans are stored as directories in \`.nanocoder/plans/${planSummary}/\`:

\`\`\`
.nanocoder/plans/${planSummary}/
├── proposal.md      # Created in Understanding phase
├── design.md        # Created in Design phase (includes interactive Q&A)
├── spec.md          # Created in Review phase
├── tasks.md         # Created in Final Plan phase
└── plan.md          # Created in Final Plan phase (consolidated view)
\`\`\`

## Tool Access in Plan Mode

**Allowed Without Approval:**
- Read operations: \`read_file\`, \`find_files\`, \`search_file_contents\`, \`list_directory\`
- Web research: \`web_search\`, \`fetch_url\`
- LSP diagnostics: \`lsp_get_diagnostics\`
- Interactive questions: \`ask_user_question\` - Use this to gather user preferences or clarify requirements

**Allowed for Plan Files Only:**
- \`write_file\` - ONLY for writing to plan documents:
  - \`.nanocoder/plans/${planSummary}/proposal.md\`
  - \`.nanocoder/plans/${planSummary}/design.md\`
  - \`.nanocoder/plans/${planSummary}/spec.md\`
  - \`.nanocoder/plans/${planSummary}/tasks.md\`
  - \`.nanocoder/plans/${planSummary}/plan.md\`

**Blocked in Plan Mode:**
- \`string_replace\` - Direct editing is disabled
- \`execute_bash\` - Command execution is disabled
- Write operations to non-plan files are blocked

**When a tool is blocked:**
- Review the error message carefully
- Use alternative approaches (read-only tools, plan document updates)
- Plan bash commands for later execution (add them to tasks.md)
`;

	return baseInstructions + getPhaseInstructions(phase, planSummary);
}

/**
 * Get the display label for a phase
 */
function getPhaseLabel(phase: PlanPhase): string {
	switch (phase) {
		case 'understanding':
			return 'Understanding';
		case 'design':
			return 'Design';
		case 'review':
			return 'Review';
		case 'final':
			return 'Final Plan';
		case 'exit':
			return 'Exit';
	}
}

/**
 * Get the display label for a document type
 */
function getDocumentLabel(docType: DocumentType): string {
	switch (docType) {
		case 'proposal':
			return 'proposal.md';
		case 'design':
			return 'design.md';
		case 'spec':
			return 'spec.md';
		case 'tasks':
			return 'tasks.md';
		case 'plan':
			return 'plan.md';
	}
}

/**
 * Get phase-specific instructions
 */
function getPhaseInstructions(phase: PlanPhase, planSummary: string): string {
	const planPath = `.nanocoder/plans/${planSummary}`;

	switch (phase) {
		case 'understanding':
			return `
## Understanding Phase

**Your Goal:** Understand the user's requirements before proposing solutions.

**What to Do:**
- Use \`ask_user_question\` to gather user preferences and clarify requirements
- Identify what success looks like
- Explore the problem space without jumping to solutions
- Gather context about the existing codebase if relevant

**Using \`ask_user_question\`:**
- Call this tool to ask clarifying questions interactively
- The tool supports 1-4 questions with 2-4 options each
- Users can select options or provide custom input
- Use this instead of asking text questions in your responses

**What NOT to Do:**
- Don't propose specific solutions yet
- Don't write implementation code
- Don't make assumptions about the approach
- Don't ask text questions - use the \`ask_user_question\` tool instead

**Document to Create: \`proposal.md\`**

When you have gathered sufficient information, create \`proposal.md\` with this structure:

\`\`\`markdown
---
summary: ${planSummary}
created: YYYY-MM-DDTHH:MM:SSZ
phase: understanding
---

# ${planSummary}

## Why

*Describe why this change is needed (50-1000 characters)...*

## What Changes

- *List the changes being made...*

## Impact

### Affected Specs

- (None or list of affected specs)

### Affected Code

- (None or list of affected files/modules)
\`\`\`

**Validation:** After writing proposal.md, it will be validated automatically. If there are errors, fix them before proceeding.

**Automatic Transition:**
Once \`proposal.md\` is created and validated, AUTOMATICALLY transition to Design by stating:
*"Moving to the Design phase to explore implementation approaches."*

DO NOT ask for permission to transition - proceed automatically when ready.
`;

		case 'design':
			return `
## Design Phase

**Your Goal:** Explore potential implementation approaches and architecture.

**Interactive Q&A BEFORE Writing \`design.md\`:**
Before writing the design document, use \`ask_user_question\` to clarify:
- Architectural preferences (e.g., "Should this use async/await or callbacks?")
- Technology choices (e.g., "Use TypeScript or JavaScript for this module?")
- Error handling approach (e.g., "Throw exceptions or return Result types?")
- Performance considerations (e.g., "Prioritize memory usage or speed?")
- Any ambiguous requirements from the proposal

**What to Do:**
- Identify relevant files and dependencies
- Explore the codebase structure using read-only tools
- Propose solution architecture and alternatives
- Consider trade-offs between different approaches
- Identify potential risks or edge cases
- Use \`ask_user_question\` for clarification on technical decisions

**Tools to Use:**
- \`read_file\` - Understand existing code
- \`find_files\` - Locate relevant modules
- \`search_file_contents\` - Find patterns or dependencies
- \`ask_user_question\` - Clarify technical decisions with the user

**What NOT to Do:**
- Don't modify any code (only read operations)
- Don't execute bash commands
- Don't finalize implementation steps yet
- Don't ask text questions - use \`ask_user_question\` instead

**Document to Create: \`design.md\`**

After exploring the codebase and gathering clarifications, create \`design.md\` with this structure:

\`\`\`markdown
---
summary: ${planSummary}
created: YYYY-MM-DDTHH:MM:SSZ
phase: design
---

# Design

## Context

*Background context about the current system and why this change is needed...*

## Goals

*List specific goals this design aims to achieve...*

## Non-Goals

*Explicitly list what is OUT OF SCOPE for this change...*

## Decisions

### Decision 1: [Title]

**What:** [Decision description]
**Why:** [Rationale]
**Alternatives Considered:** [List of alternatives with trade-offs]

*(Repeat for each key decision)*

## Risks & Trade-offs

| Risk | Mitigation |
|------|------------|
| [Risk description] | [How to address it] |

## Migration Plan

*Steps to migrate from current state to new state...*

## Rollback Plan

*How to undo the change if needed...*

## Open Questions

*Any unresolved questions or areas needing further exploration...*
\`\`\`

**Validation:** After writing design.md, it will be validated automatically. Fix any errors before proceeding.

**Automatic Transition:**
Once \`design.md\` is created and validated, AUTOMATICALLY transition to Review by stating:
*"Moving to the Review phase to create specification documents."*

DO NOT stop and wait for user input. DO NOT ask if the user wants you to proceed.
`;

		case 'review':
			return `
## Review Phase

**Your Goal:** Create specification documents with requirements and Gherkin scenarios.

**What to Do:**
- Review proposal.md and design.md
- Define requirements in delta format (ADDED/MODIFIED/REMOVED/RENAMED)
- Add Gherkin scenarios for each requirement
- Use \`ask_user_question\` if you need clarification on requirements

**Gherkin Scenario Format:**
\`\`\`markdown
### Requirement Name

**Scenario:** [Scenario description]

**GIVEN** [Initial context]
**WHEN** [Action taken]
**THEN** [Expected outcome]
\`\`\`

**Document to Create: \`spec.md\`**

Create \`spec.md\` with this structure:

\`\`\`markdown
---
summary: ${planSummary}
created: YYYY-MM-DDTHH:MM:SSZ
phase: review
---

# Specification

## ADDED Requirements

### [Requirement Name]

[Requirement description...]

#### Scenarios

**Scenario:** [Scenario name]

**GIVEN** [when condition]
**WHEN** [when condition]
**THEN** [then condition]

*(Repeat for each ADDED requirement)*

## MODIFIED Requirements

### [Requirement Name]

[Full updated requirement description...]

#### Scenarios

**Scenario:** [Scenario name]

**GIVEN** [when condition]
**WHEN** [when condition]
**THEN** [then condition]

*(Repeat for each MODIFIED requirement)*

## REMOVED Requirements

### [Requirement Name]

**Reason:** [Why it's being removed]
**Migration:** [How to migrate away from this requirement]

*(Repeat for each REMOVED requirement)*

## RENAMED Requirements

- \`[Old name]\` → \`[New name]\`
\`\`\`

**Validation:** After writing spec.md, it will be validated automatically. Fix any errors before proceeding.

**Automatic Transition:**
Once \`spec.md\` is created and validated, AUTOMATICALLY transition to Final Plan by stating:
*"Moving to the Final Plan phase to create the executable task list."*

DO NOT stop and wait for user input.
`;

		case 'final':
			return `
## Final Plan Phase

**Your Goal:** Create implementation task list and consolidated plan document.

**What to Do:**
- Break down the work into specific, actionable steps
- Order steps logically (dependencies first)
- Organize tasks by category (Implementation, Testing, Documentation, Deployment)
- Create consolidated plan.md overview

**Documents to Create:**

### 1. \`tasks.md\`

\`\`\`markdown
---
summary: ${planSummary}
created: YYYY-MM-DDTHH:MM:SSZ
phase: final
---

# Implementation Tasks

## 1. Implementation

- [ ] 1.1 [First implementation task]
- [ ] 1.2 [Second implementation task]
...

## 2. Testing

- [ ] 2.1 [First testing task]
- [ ] 2.2 [Second testing task]
...

## 3. Documentation

- [ ] 3.1 [Documentation task]
...

## 4. Deployment

- [ ] 4.1 [Deployment task]
...
\`\`\`

### 2. \`plan.md\` (Consolidated View)

\`\`\`markdown
---
summary: ${planSummary}
created: YYYY-MM-DDTHH:MM:SSZ
phase: final
---

# ${planSummary}

## Overview

[Summary from proposal.md...]

## Design Summary

[Key decisions from design.md...]

## Spec Summary

[Summary of requirements from spec.md...]

## Tasks

[Summary from tasks.md...]
\`\`\`

**Validation:** After writing both documents, they will be validated automatically. Fix any errors before proceeding.

**Before calling exit-plan-mode:**
- Use \`ask_user_question\` if you need any clarification on the plan
- Once you have all the information needed, call \`exit-plan-mode\` immediately

**CRITICAL - Required Action:**
Once both \`tasks.md\` and \`plan.md\` are complete and validated, you MUST immediately call the \`exit-plan-mode\` **TOOL**.

**IMPORTANT - You MUST make a TOOL CALL:**
- Do NOT just say "I'm calling exit-plan-mode" or similar text
- You MUST invoke the actual \`exit-plan-mode\` tool in your tool_calls section
- The tool call format is: \`{"name": "exit-plan-mode", "arguments": {}}\`
- This will trigger an interactive mode selection prompt for the user

**Do NOT:**
- Ask "Would you like me to proceed?" or similar text questions
- Ask for textual approval before calling the tool
- Present options as text - the tool will handle presenting options
- Pass any arguments to exit-plan-mode - call it with empty object \`{}\`
- Just SAY you're calling the tool - actually CALL it as a tool

**Do:**
- Call the \`exit-plan-mode\` TOOL immediately after writing and validating the final documents
- Call it with empty object \`{}\` as arguments
- STOP - do not add any text after calling the tool

**Example completion sequence:**
1. Write \`tasks.md\` to ${planPath}/tasks.md
2. Write \`plan.md\` to ${planPath}/plan.md
3. Wait for validation to complete (automatic)
4. Make a TOOL CALL: \`exit-plan-mode\` with arguments \`{}\`
5. STOP - do not add any text after calling the tool

The exit-plan-mode tool will automatically:
- Present an interactive mode selection prompt with keyboard navigation
- Show options: "Accept plan (Normal Mode)", "Accept plan (Auto-Accept Mode)", "Modify Plan"
- Handle the mode transition when user makes their selection
`;

		case 'exit':
			return `
## Exit Phase

**Plan Complete!**

All documents have been created and validated. Your ONLY action here is to call the \`exit-plan-mode\` **TOOL**.

**You MUST make an actual TOOL CALL:**
- Call the tool: \`{"name": "exit-plan-mode", "arguments": {}}\`
- Do NOT just write text saying you're calling it
- Do NOT add any other text or explanation

The \`exit-plan-mode\` tool will:
1. Present an interactive mode selection prompt with keyboard navigation
2. Show options: "Accept plan (Normal Mode)", "Accept plan (Auto-Accept Mode)", "Modify Plan"
3. Allow the user to select their preferred implementation mode
4. Handle the mode transition automatically

**Do NOT:**
- Present the plan content as text in your response
- Ask "Would you like me to proceed?" or similar questions
- Present approval options as text - the tool handles this
- Just SAY you're calling the tool - actually CALL it

**Do:**
- Call \`exit-plan-mode\` as a TOOL with empty object \`{}\` immediately
- STOP - do not add any text after calling the tool
- Let the tool handle everything else
`;
	}
}

/**
 * Get the tool approval instructions for plan mode
 *
 * This is used to inform tools about plan mode restrictions
 */
export function getPlanModeToolInstructions(planSummary: string): string {
	return `**Plan Mode Tool Restrictions:**

You are in Plan Mode. The following tool restrictions apply:

**ALLOWED WITHOUT APPROVAL:**
- read_file - Read file contents
- find_files - Search for files by pattern
- search_file_contents - Search within files
- list_directory - List directory contents
- web_search - Search the web
- fetch_url - Fetch URL content
- lsp_get_diagnostics - Get LSP diagnostics
- ask_user_question - Interactive questions for user clarification
- write_file - ONLY for plan documents in .nanocoder/plans/${planSummary}/

**PLAN DOCUMENT PATHS:**
- .nanocoder/plans/${planSummary}/proposal.md
- .nanocoder/plans/${planSummary}/design.md
- .nanocoder/plans/${planSummary}/spec.md
- .nanocoder/plans/${planSummary}/tasks.md
- .nanocoder/plans/${planSummary}/plan.md

**BLOCKED IN PLAN MODE:**
- string_replace - Direct editing disabled
- execute_bash - Command execution disabled
- write_file to non-plan paths - Blocked

If a tool is blocked, use read-only alternatives and document your findings in the plan documents.`;
}
