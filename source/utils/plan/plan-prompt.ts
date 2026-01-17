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

Plan Mode follows a 5-phase workflow. Phase transitions happen **AUTOMATICALLY** - you do NOT need to ask for user approval to move between phases:

1. **Understanding** - Gather requirements and clarify scope
2. **Design** - Explore approaches and identify relevant files
3. **Review** - Consolidate findings and prepare final plan
4. **Final Plan** - Create executable task list
5. **Exit** - Complete planning and present for user approval

**Important:** All phase transitions are automatic. Only the FINAL PLAN presented in the Exit phase requires user review and approval.

## Tool Access in Plan Mode

**Allowed Without Approval:**
- Read operations: \`read_file\`, \`find_files\`, \`search_file_contents\`, \`list_directory\`
- Web research: \`web_search\`, \`fetch_url\`
- LSP diagnostics: \`lsp_get_diagnostics\`
- Interactive questions: \`ask_user_question\` - Use this to gather user preferences or clarify requirements

**Allowed for Plan Files Only:**
- \`write_file\` - ONLY for writing to \`.nanocoder/plans/${planId}.md\`
- You CAN and SHOULD update the plan file as you progress through phases

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

**Automatic Transition:**
Once you have gathered sufficient information about the requirements, AUTOMATICALLY transition to the Design phase by stating:
*"Moving to the Design phase to explore implementation approaches."*

DO NOT ask for permission to transition - proceed automatically when ready.
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
- Use \`ask_user_question\` if you need clarification on implementation preferences or architectural choices

**Tools to Use:**
- Use \`read_file\` to understand existing code
- Use \`find_files\` to locate relevant modules
- Use \`search_file_contents\` to find patterns or dependencies
- Use \`ask_user_question\` to clarify technical decisions with the user
- Document your findings in the plan file

**What NOT to Do:**
- Don't modify any code (only read operations)
- Don't execute bash commands
- Don't finalize implementation steps yet
- Don't ask text questions - use \`ask_user_question\` instead

**CRITICAL - Keep Going:**
After updating the plan file with the design phase content, you MUST immediately continue to the next phase.
DO NOT stop and wait for user input.
DO NOT ask if the user wants you to proceed.

**Automatic Transition:**
Once you have explored the codebase and identified a solid approach, AUTOMATICALLY transition to Review by stating:
*"Moving to the Review phase to consolidate the plan."*

Then continue with consolidating your findings in the Review phase.
`;

		case 'review':
			return `
## Review Phase

**Your Goal:** Consolidate findings and prepare the final executable plan.

**What to Do:**
- Present a clear summary of the planned changes
- Highlight key decisions and trade-offs
- List files that will be modified
- Outline the implementation approach
- Update the plan file with a complete implementation strategy
- Use \`ask_user_question\` if you need clarification on any aspect of the plan before finalizing

**Plan Structure:**
Update the plan file to include:
1. **Summary** - What will be done and why
2. **Files to Modify** - List of files with intended changes
3. **Implementation Steps** - High-level approach
4. **Risks/Considerations** - Potential issues or edge cases

**CRITICAL - Keep Going:**
After updating the plan file with the review phase content, you MUST immediately continue to the next phase.
DO NOT stop and wait for user input.
DO NOT ask if the user wants you to proceed.
DO NOT say "Let me know if you'd like me to continue."
DO NOT ask text questions - use \`ask_user_question\` if you need clarification.

**Automatic Transition:**
Immediately after writing the review phase to the plan file, transition to Final Plan by stating:
*"Moving to the Final Plan phase to create the executable task list."*

Then continue with creating the detailed executable task list in the Final Plan phase.
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

**Before calling exit-plan-mode:**
- If you need any clarification on the plan (e.g., implementation preferences, testing approach), use \`ask_user_question\` first
- Once you have all the information needed, call \`exit-plan-mode\` immediately

**CRITICAL - Required Action:**
Once the final plan is complete and written to the plan file, you MUST immediately call the \`exit-plan-mode\` tool.

**Do NOT:**
- Ask "Would you like me to proceed?" or similar text questions
- Ask for textual approval before calling the tool
- Present options as text - the tool will handle presenting options
- Pass any arguments to exit-plan-mode - call it WITHOUT parameters

**Do:**
- Call \`exit-plan-mode\` immediately after writing the final plan
- Call it WITHOUT any arguments or parameters
- Let the tool handle the user interaction and mode selection

**Example completion sequence:**
1. Write the final plan to .nanocoder/plans/\${planId}.md
2. Call \`exit-plan-mode\` with NO arguments - just the tool name
3. STOP - do not add any text after calling the tool

The exit-plan-mode tool will automatically:
- Present an interactive mode selection prompt with keyboard navigation
- Show options: "Accept plan (Normal Mode)", "Accept plan (Auto-Accept Mode)", "Modify Plan"
- Handle the mode transition when user makes their selection
`;

		case 'exit':
			return `
## Exit Phase

**Plan Complete!**

The plan has been finalized and is ready for implementation.

**IMPORTANT:** You are now in the Exit phase. Your ONLY action here is to call the \`exit-plan-mode\` tool.

The \`exit-plan-mode\` tool will:
1. Present an interactive mode selection prompt with keyboard navigation
2. Show options: "Accept plan (Normal Mode)", "Accept plan (Auto-Accept Mode)", "Modify Plan"
3. Allow the user to select their preferred implementation mode
4. Handle the mode transition automatically

**Do NOT:**
- Present the plan content as text in your response
- Ask "Would you like me to proceed?" or similar questions
- Present approval options as text - the tool handles this
- Pass any arguments to exit-plan-mode - call it WITHOUT parameters

**Do:**
- Call \`exit-plan-mode\` with NO arguments immediately
- STOP - do not add any text after calling the tool
- Let the tool handle everything else

**Tool Usage:**
Call \`exit-plan-mode\` with NO arguments (just the tool name, no parameters).

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
- ask_user_question - Interactive questions for user clarification
- write_file - ONLY for .nanocoder/plans/{planId}.md

BLOCKED IN PLAN MODE:
- string_replace - Direct editing disabled
- execute_bash - Command execution disabled
- write_file to non-plan paths - Blocked

If a tool is blocked, use read-only alternatives and document your findings in the plan file.`;
}
