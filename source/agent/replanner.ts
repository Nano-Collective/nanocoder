/**
 * Replanner
 *
 * Simple replanning logic - skip blocked tasks and continue.
 */

import {TaskStore} from './task-store';

/**
 * Check if replanning should be triggered after a task fails
 */
export function shouldReplan(taskStore: TaskStore): boolean {
	const plan = taskStore.getPlan();
	if (!plan) return false;

	const status = taskStore.getStatusSummary();

	// Replan if there are failures or all remaining tasks are blocked
	const hasFailures = status.failed > 0;
	const allBlocked =
		status.pending === 0 && status.inProgress === 0 && status.blocked > 0;

	return hasFailures || allBlocked;
}

/**
 * Simple replanning - skip blocked tasks and continue
 */
export function simpleReplan(taskStore: TaskStore): {
	canProceed: boolean;
	tasksSkipped: number;
} {
	const plan = taskStore.getPlan();
	if (!plan) {
		return {canProceed: false, tasksSkipped: 0};
	}

	// Skip all blocked tasks
	let skipped = 0;
	for (const task of plan.tasks) {
		if (task.status === 'blocked') {
			taskStore.skipTask(task.id);
			skipped++;
		}
	}

	// Check if there are still pending tasks
	const hasPending = plan.tasks.some(t => t.status === 'pending');

	return {
		canProceed: hasPending,
		tasksSkipped: skipped,
	};
}
