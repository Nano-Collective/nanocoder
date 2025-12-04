/**
 * Context Synthesizer
 *
 * Generates summaries of plan execution.
 */

import type {Task} from './types';

/**
 * Generate a summary of the entire plan execution
 */
export function generatePlanSummary(
	originalGoal: string,
	completedTasks: Task[],
	failedTasks: Task[],
): string {
	const lines: string[] = [];

	lines.push(`## Summary`);
	lines.push('');
	lines.push(`**Goal:** ${originalGoal}`);
	lines.push('');

	if (completedTasks.length > 0) {
		lines.push(`### Completed Tasks (${completedTasks.length})`);
		for (const task of completedTasks) {
			lines.push(`- **${task.title}**: ${task.result?.summary || 'Done'}`);
		}
		lines.push('');
	}

	if (failedTasks.length > 0) {
		lines.push(`### Failed Tasks (${failedTasks.length})`);
		for (const task of failedTasks) {
			lines.push(`- **${task.title}**: ${task.result?.error || 'Failed'}`);
		}
		lines.push('');
	}

	// Collect all discoveries
	const allDiscoveries: string[] = [];
	for (const task of completedTasks) {
		allDiscoveries.push(...task.context.discoveries);
	}

	if (allDiscoveries.length > 0) {
		lines.push(`### Key Discoveries`);
		const unique = [...new Set(allDiscoveries)].slice(0, 5);
		for (const discovery of unique) {
			lines.push(`- ${discovery}`);
		}
		lines.push('');
	}

	// Collect all files modified
	const filesModified = new Set<string>();
	for (const task of completedTasks) {
		for (const file of task.context.filesModified) {
			filesModified.add(file);
		}
	}

	if (filesModified.size > 0) {
		lines.push(`### Files Modified`);
		for (const file of filesModified) {
			lines.push(`- ${file}`);
		}
	}

	return lines.join('\n');
}
