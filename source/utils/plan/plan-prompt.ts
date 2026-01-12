/**
 * Plan Mode AI Prompts
 *
 * Provides mode-specific instructions for the 5-phase plan workflow.
 * These prompts are injected into the system message when plan mode is active.
 */

import type {PlanPhase} from '@/types/core';

/**
 * Get the plan mode instructions for the given phase
 *
 * @param phase - Current workflow phase
 * @param planId - Active plan identifier
 * @returns Plan mode instructions string
 */
export function getPlanModePrompt(phase: PlanPhase, planId: string): string {
	const baseInstructions = `# Plan Mode Active

You are in **Plan Mode** - a structured planning workflow for thoughtful code changes.

**Current Plan:** \`${planId}\`
**Current Phase:** ${getPhaseLabel(phase)}

## Overview

Plan Mode follows a 5-phase workflow:
1. **Understanding** - Gather requirements and clarify scope
2. **Design** - Explore approaches and identify relevant files
3. **Review** - Present consolidated plan for feedback
4. **Final Plan** - Create executable task list
5. **Exit** - Complete planning and present for approval

## Tool Access in Plan Mode

**Allowed Without Approval:**
- Read operations: \`read_file\`, \`find_files\`, \`search_file_contents\`, \`list_directory\`
- Web research: \`web_search\`, \`fetch_url\`
- LSP diagnostics: \`lsp_get_diagnostics\`

**Allowed for Plan Files Only:**
- \`write_file\` - ONLY for writing to \`.nanocoder/plans/${planId}.md\`
- You CAN update the plan file as you progress through phases

**Blocked in Plan Mode:**
- \`string_replace\` - Direct editing is disabled
- \`execute_bash\` - Command execution is disabled
- Write operations to non-plan files are blocked

**When a tool is blocked:**
- Review the error message carefully
- Use alternative approaches (read-only tools, plan file updates)
- Plan bash commands for later execution (add them to the plan file)
`;

	return baseInstructions + getPhaseInstructions(phase);
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
 * Get phase-specific instructions
 */
function getPhaseInstructions(phase: PlanPhase): string {
	switch (phase) {
		case 'understanding':
			return `
## Understanding Phase

**Your Goal:** Understand the user's requirements before proposing solutions.

**What to Do:**
- Ask clarifying questions about goals and constraints
- Identify what success looks like
- Explore the problem space without jumping to solutions
- Gather context about the existing codebase if relevant

**What NOT to Do:**
- Don't propose specific solutions yet
- Don't write implementation code
- Don't make assumptions about the approach

**Transition to Design Phase:**
Once you understand the requirements, transition to the Design phase by stating:
*"I'm moving to the Design phase to explore implementation approaches."*
`;

		case 'design':
			return `
## Design Phase

**Your Goal:** Explore potential implementation approaches and architecture.

**What to Do:**
- Identify relevant files and dependencies
- Explore the codebase structure using read-only tools
- Propose solution architecture and alternatives
- Consider trade-offs between different approaches
- Identify potential risks or edge cases

**What to Do:**
- Use \`read_file\` to understand existing code
- Use \`find_files\` to locate relevant modules
- Use \`search_file_contents\` to find patterns or dependencies
- Document your findings in the plan file

**What NOT to Do:**
- Don't modify any code (only read operations)
- Don't execute bash commands
- Don't finalize implementation steps yet

**Transition to Review Phase:**
Once you have a solid design approach, transition to Review by stating:
*"I'm moving to the Review phase to present the plan for your feedback."*
`;

		case 'review':
			return `
## Review Phase

**Your Goal:** Present a consolidated plan and gather user feedback.

**What to Do:**
- Present a clear summary of the planned changes
- Highlight key decisions and trade-offs
- List files that will be modified
- Outline the implementation approach
- Ask specific questions to validate assumptions

**Plan Structure:**
Update the plan file to include:
1. **Summary** - What will be done and why
2. **Files to Modify** - List of files with intended changes
3. **Implementation Steps** - High-level approach
4. **Risks/Considerations** - Potential issues or edge cases

**User Feedback:**
- Address user concerns thoroughly
- Iterate on the plan based on feedback
- Be willing to revise the approach

**Transition to Final Plan Phase:**
Once the user approves the approach, transition by stating:
*"I'm moving to the Final Plan phase to create the executable task list."*
`;

		case 'final':
			return `
## Final Plan Phase

**Your Goal:** Create a detailed, executable task list.

**What to Do:**
- Break down the work into specific, actionable steps
- Order steps logically (dependencies first)
- Specify exact file changes needed
- Include any necessary configuration changes
- Add testing and verification steps

**Final Plan Structure:**
Update the plan file with:
1. **Implementation Steps** - Ordered list of specific actions
2. **File Changes** - Exact modifications for each file
3. **Testing Steps** - How to verify the changes work
4. **Rollback Plan** - How to undo if needed (if applicable)

**Completing the Plan:**
Once the final plan is ready, call the \`exit-plan-mode\` tool to present it for user approval.
`;

		case 'exit':
			return `
## Exit Phase

**Plan Complete!**

The plan has been finalized and is ready for implementation.

When you call \`exit-plan-mode\`, the system will:
1. Present the full plan to the user
2. Ask for approval to proceed with implementation
3. Transition to the selected mode (normal or auto-accept) for execution

**After Plan Mode:**
- If approved in normal mode: Each tool will require confirmation
- If approved in auto-accept mode: Tools will execute automatically
- The plan file remains for reference during implementation
`;
	}
}

/**
 * Get the tool approval instructions for plan mode
 *
 * This is used to inform tools about plan mode restrictions
 */
export function getPlanModeToolInstructions(): string {
	return `**Plan Mode Tool Restrictions:**

You are in Plan Mode. The following tool restrictions apply:

ALLOWED WITHOUT APPROVAL:
- read_file - Read file contents
- find_files - Search for files by pattern
- search_file_contents - Search within files
- list_directory - List directory contents
- web_search - Search the web
- fetch_url - Fetch URL content
- lsp_get_diagnostics - Get LSP diagnostics
- write_file - ONLY for .nanocoder/plans/{planId}.md

BLOCKED IN PLAN MODE:
- string_replace - Direct editing disabled
- execute_bash - Command execution disabled
- write_file to non-plan paths - Blocked

If a tool is blocked, use read-only alternatives and document your findings in the plan file.`;
}
