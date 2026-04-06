/**
 * Subagent Execution Events
 *
 * Mutable state store for subagent progress, polled by the UI component.
 * Uses a simple mutable object instead of EventEmitter to avoid
 * Ink render flushing issues with in-process async execution.
 */

export interface SubagentEvent {
	subagentName: string;
	status: 'running' | 'tool_call' | 'complete' | 'error';
	currentTool?: string;
	toolCallCount: number;
	turnCount: number;
	tokenCount: number;
}

/** Mutable progress state — written by executor, polled by UI */
export const subagentProgress: SubagentEvent = {
	subagentName: '',
	status: 'running',
	toolCallCount: 0,
	turnCount: 0,
	tokenCount: 0,
};

/** Update progress — called by the executor */
export function updateSubagentProgress(event: SubagentEvent): void {
	subagentProgress.subagentName = event.subagentName;
	subagentProgress.status = event.status;
	subagentProgress.currentTool = event.currentTool;
	subagentProgress.toolCallCount = event.toolCallCount;
	subagentProgress.turnCount = event.turnCount;
	subagentProgress.tokenCount = event.tokenCount;
}

/** Reset progress state */
export function resetSubagentProgress(): void {
	subagentProgress.subagentName = '';
	subagentProgress.status = 'running';
	subagentProgress.currentTool = undefined;
	subagentProgress.toolCallCount = 0;
	subagentProgress.turnCount = 0;
	subagentProgress.tokenCount = 0;
}
