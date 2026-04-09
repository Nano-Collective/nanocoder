/**
 * Subagent Execution Events
 *
 * Mutable state store for subagent progress, polled by the UI component.
 * Uses simple mutable objects instead of EventEmitter to avoid
 * Ink render flushing issues with in-process async execution.
 *
 * Supports multiple concurrent agents via a Map keyed by agentId.
 */

export interface SubagentEvent {
	subagentName: string;
	status: 'running' | 'tool_call' | 'complete' | 'error';
	currentTool?: string;
	toolCallCount: number;
	turnCount: number;
	tokenCount: number;
}

/** Map of agent instance ID → progress state for concurrent agents */
const subagentProgressMap = new Map<string, SubagentEvent>();

/**
 * Legacy single-agent progress state.
 * Still used by single-agent callers and as a fallback.
 */
export const subagentProgress: SubagentEvent = {
	subagentName: '',
	status: 'running',
	toolCallCount: 0,
	turnCount: 0,
	tokenCount: 0,
};

/** Get progress for a specific agent instance */
export function getSubagentProgress(agentId: string): SubagentEvent {
	return subagentProgressMap.get(agentId) ?? subagentProgress;
}

/** Get all active agent progress entries */
export function getAllSubagentProgress(): Map<string, SubagentEvent> {
	return subagentProgressMap;
}

/** Update progress for a specific agent instance */
export function updateSubagentProgressById(
	agentId: string,
	event: SubagentEvent,
): void {
	const existing = subagentProgressMap.get(agentId);
	if (existing) {
		existing.subagentName = event.subagentName;
		existing.status = event.status;
		existing.currentTool = event.currentTool;
		existing.toolCallCount = event.toolCallCount;
		existing.turnCount = event.turnCount;
		existing.tokenCount = event.tokenCount;
	} else {
		subagentProgressMap.set(agentId, {...event});
	}
}

/** Update progress — called by the executor (legacy single-agent path) */
export function updateSubagentProgress(event: SubagentEvent): void {
	subagentProgress.subagentName = event.subagentName;
	subagentProgress.status = event.status;
	subagentProgress.currentTool = event.currentTool;
	subagentProgress.toolCallCount = event.toolCallCount;
	subagentProgress.turnCount = event.turnCount;
	subagentProgress.tokenCount = event.tokenCount;
}

/** Reset progress for a specific agent instance */
export function resetSubagentProgressById(agentId: string): void {
	subagentProgressMap.set(agentId, {
		subagentName: '',
		status: 'running',
		toolCallCount: 0,
		turnCount: 0,
		tokenCount: 0,
	});
}

/** Remove a specific agent's progress entry */
export function removeSubagentProgress(agentId: string): void {
	subagentProgressMap.delete(agentId);
}

/** Clear all concurrent agent progress entries */
export function clearAllSubagentProgress(): void {
	subagentProgressMap.clear();
}

/** Reset legacy single-agent progress state */
export function resetSubagentProgress(): void {
	subagentProgress.subagentName = '';
	subagentProgress.status = 'running';
	subagentProgress.currentTool = undefined;
	subagentProgress.toolCallCount = 0;
	subagentProgress.turnCount = 0;
	subagentProgress.tokenCount = 0;
}
