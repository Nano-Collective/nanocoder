/**
 * Task Store
 *
 * Manages the state of tasks throughout plan execution.
 * Provides methods for creating plans, updating task status,
 * and retrieving accumulated context.
 */

import type {
	Task,
	TaskPlan,
	TaskDefinition,
	TaskResult,
	TaskContext,
	AccumulatedContext,
	PlanEvent,
	PlanEventHandler,
} from './types';

/**
 * Generates a unique ID for tasks and plans
 */
function generateId(): string {
	return `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}

/**
 * Creates an empty task context
 */
function createEmptyContext(): TaskContext {
	return {
		filesRead: [],
		filesModified: [],
		discoveries: [],
		decisions: [],
	};
}

/**
 * Converts a TaskDefinition to a Task with initial state
 */
function definitionToTask(definition: TaskDefinition): Task {
	return {
		...definition,
		status: 'pending',
		context: createEmptyContext(),
	};
}

/**
 * TaskStore manages task state throughout plan execution
 */
export class TaskStore {
	private plan: TaskPlan | null = null;
	private eventHandlers: PlanEventHandler[] = [];

	/**
	 * Create a new plan from task definitions
	 */
	createPlan(
		originalGoal: string,
		taskDefinitions: TaskDefinition[],
	): TaskPlan {
		const tasks = taskDefinitions.map(definitionToTask);
		const executionOrder = this.topologicalSort(tasks);

		this.plan = {
			id: generateId(),
			originalGoal,
			tasks,
			executionOrder,
			createdAt: Date.now(),
			status: 'executing',
		};

		this.emit({type: 'plan_created', plan: this.plan});
		return this.plan;
	}

	/**
	 * Get the current plan
	 */
	getPlan(): TaskPlan | null {
		return this.plan;
	}

	/**
	 * Check if there are more tasks to execute
	 */
	hasNextTask(): boolean {
		if (!this.plan) return false;
		return this.plan.tasks.some(t => t.status === 'pending');
	}

	/**
	 * Get the next task to execute (first pending task in execution order)
	 */
	getNextTask(): Task | null {
		if (!this.plan) return null;

		for (const taskId of this.plan.executionOrder) {
			const task = this.getTask(taskId);
			if (!task) continue;

			if (task.status === 'pending') {
				// Check if all dependencies are completed
				const dependenciesMet = task.dependencies.every(depId => {
					const depTask = this.getTask(depId);
					return depTask?.status === 'completed';
				});

				if (dependenciesMet) {
					return task;
				}

				// Check if any dependency failed (task is blocked)
				const hasFailedDependency = task.dependencies.some(depId => {
					const depTask = this.getTask(depId);
					return depTask?.status === 'failed';
				});

				if (hasFailedDependency) {
					this.blockTask(taskId, 'Dependency failed');
				}
			}
		}

		return null;
	}

	/**
	 * Get a task by ID
	 */
	getTask(taskId: string): Task | null {
		if (!this.plan) return null;
		return this.plan.tasks.find(t => t.id === taskId) || null;
	}

	/**
	 * Start executing a task
	 */
	startTask(taskId: string): void {
		const task = this.getTask(taskId);
		if (!task) return;

		task.status = 'in_progress';
		task.startedAt = Date.now();

		this.emit({type: 'task_started', task});
	}

	/**
	 * Mark a task as completed
	 */
	completeTask(taskId: string, result: TaskResult): void {
		const task = this.getTask(taskId);
		if (!task) return;

		task.status = 'completed';
		task.completedAt = Date.now();
		task.result = result;

		this.emit({type: 'task_completed', task, result});

		// Check if all tasks are done
		this.checkPlanCompletion();
	}

	/**
	 * Mark a task as failed
	 */
	failTask(taskId: string, error: string): void {
		const task = this.getTask(taskId);
		if (!task) return;

		task.status = 'failed';
		task.completedAt = Date.now();
		task.result = {
			success: false,
			summary: 'Task failed',
			passToNext: [],
			error,
		};

		this.emit({type: 'task_failed', task, error});

		// Block dependent tasks
		this.blockDependentTasks(taskId);

		// Check if plan should fail
		this.checkPlanCompletion();
	}

	/**
	 * Mark a task as blocked
	 */
	blockTask(taskId: string, reason: string): void {
		const task = this.getTask(taskId);
		if (!task) return;

		task.status = 'blocked';
		task.result = {
			success: false,
			summary: `Blocked: ${reason}`,
			passToNext: [],
			error: reason,
		};
	}

	/**
	 * Skip a task (used during replanning)
	 */
	skipTask(taskId: string): void {
		const task = this.getTask(taskId);
		if (!task) return;

		task.status = 'skipped';
	}

	/**
	 * Add a discovery to a task's context
	 */
	addDiscovery(taskId: string, discovery: string): void {
		const task = this.getTask(taskId);
		if (!task) return;

		task.context.discoveries.push(discovery);
	}

	/**
	 * Add a decision to a task's context
	 */
	addDecision(taskId: string, decision: string): void {
		const task = this.getTask(taskId);
		if (!task) return;

		task.context.decisions.push(decision);
	}

	/**
	 * Record a file that was read
	 */
	addFileRead(taskId: string, filePath: string): void {
		const task = this.getTask(taskId);
		if (!task) return;

		if (!task.context.filesRead.includes(filePath)) {
			task.context.filesRead.push(filePath);
		}
	}

	/**
	 * Record a file that was modified
	 */
	addFileModified(taskId: string, filePath: string): void {
		const task = this.getTask(taskId);
		if (!task) return;

		if (!task.context.filesModified.includes(filePath)) {
			task.context.filesModified.push(filePath);
		}
	}

	/**
	 * Get accumulated context from all completed tasks
	 */
	getAccumulatedContext(): AccumulatedContext {
		if (!this.plan) {
			return {
				originalGoal: '',
				discoveries: [],
				decisions: [],
				filesRead: [],
				filesModified: [],
				taskSummaries: [],
			};
		}

		const completedTasks = this.plan.tasks.filter(
			t => t.status === 'completed',
		);

		const discoveries: string[] = [];
		const decisions: string[] = [];
		const filesRead: string[] = [];
		const filesModified: string[] = [];
		const taskSummaries: Array<{
			taskId: string;
			title: string;
			summary: string;
		}> = [];

		for (const task of completedTasks) {
			discoveries.push(...task.context.discoveries);
			decisions.push(...task.context.decisions);

			for (const file of task.context.filesRead) {
				if (!filesRead.includes(file)) {
					filesRead.push(file);
				}
			}

			for (const file of task.context.filesModified) {
				if (!filesModified.includes(file)) {
					filesModified.push(file);
				}
			}

			if (task.result) {
				taskSummaries.push({
					taskId: task.id,
					title: task.title,
					summary: task.result.summary,
				});
			}
		}

		return {
			originalGoal: this.plan.originalGoal,
			discoveries,
			decisions,
			filesRead,
			filesModified,
			taskSummaries,
		};
	}

	/**
	 * Get results from a task's dependencies
	 */
	getDependencyResults(taskId: string): TaskResult[] {
		const task = this.getTask(taskId);
		if (!task) return [];

		const results: TaskResult[] = [];
		for (const depId of task.dependencies) {
			const depTask = this.getTask(depId);
			if (depTask?.result) {
				results.push(depTask.result);
			}
		}

		return results;
	}

	/**
	 * Get status summary of all tasks
	 */
	getStatusSummary(): {
		total: number;
		pending: number;
		inProgress: number;
		completed: number;
		failed: number;
		blocked: number;
		skipped: number;
	} {
		if (!this.plan) {
			return {
				total: 0,
				pending: 0,
				inProgress: 0,
				completed: 0,
				failed: 0,
				blocked: 0,
				skipped: 0,
			};
		}

		const counts = {
			total: this.plan.tasks.length,
			pending: 0,
			inProgress: 0,
			completed: 0,
			failed: 0,
			blocked: 0,
			skipped: 0,
		};

		for (const task of this.plan.tasks) {
			switch (task.status) {
				case 'pending':
					counts.pending++;
					break;
				case 'in_progress':
					counts.inProgress++;
					break;
				case 'completed':
					counts.completed++;
					break;
				case 'failed':
					counts.failed++;
					break;
				case 'blocked':
					counts.blocked++;
					break;
				case 'skipped':
					counts.skipped++;
					break;
			}
		}

		return counts;
	}

	/**
	 * Add new tasks to the plan (used during replanning)
	 */
	addTasks(taskDefinitions: TaskDefinition[]): void {
		if (!this.plan) return;

		const newTasks = taskDefinitions.map(definitionToTask);
		this.plan.tasks.push(...newTasks);

		// Re-sort execution order
		this.plan.executionOrder = this.topologicalSort(this.plan.tasks);

		this.emit({type: 'plan_updated', plan: this.plan});
	}

	/**
	 * Remove a task from the plan (used during replanning)
	 */
	removeTask(taskId: string): void {
		if (!this.plan) return;

		this.plan.tasks = this.plan.tasks.filter(t => t.id !== taskId);
		this.plan.executionOrder = this.plan.executionOrder.filter(
			id => id !== taskId,
		);

		this.emit({type: 'plan_updated', plan: this.plan});
	}

	/**
	 * Subscribe to plan events
	 */
	subscribe(handler: PlanEventHandler): () => void {
		this.eventHandlers.push(handler);
		return () => {
			this.eventHandlers = this.eventHandlers.filter(h => h !== handler);
		};
	}

	/**
	 * Clear the current plan
	 */
	clear(): void {
		this.plan = null;
	}

	// ========================================================================
	// Private methods
	// ========================================================================

	/**
	 * Emit an event to all subscribers
	 */
	private emit(event: PlanEvent): void {
		for (const handler of this.eventHandlers) {
			try {
				handler(event);
			} catch (error) {
				console.error('Error in plan event handler:', error);
			}
		}
	}

	/**
	 * Topologically sort tasks by dependencies
	 */
	private topologicalSort(tasks: Task[]): string[] {
		const taskMap = new Map<string, Task>();
		for (const task of tasks) {
			taskMap.set(task.id, task);
		}

		const visited = new Set<string>();
		const result: string[] = [];

		const visit = (taskId: string): void => {
			if (visited.has(taskId)) return;
			visited.add(taskId);

			const task = taskMap.get(taskId);
			if (!task) return;

			// Visit dependencies first
			for (const depId of task.dependencies) {
				visit(depId);
			}

			result.push(taskId);
		};

		for (const task of tasks) {
			visit(task.id);
		}

		return result;
	}

	/**
	 * Block all tasks that depend on a failed task
	 */
	private blockDependentTasks(failedTaskId: string): void {
		if (!this.plan) return;

		for (const task of this.plan.tasks) {
			if (
				task.dependencies.includes(failedTaskId) &&
				task.status === 'pending'
			) {
				this.blockTask(task.id, `Dependency "${failedTaskId}" failed`);
				// Recursively block tasks that depend on this one
				this.blockDependentTasks(task.id);
			}
		}
	}

	/**
	 * Check if the plan is complete (all tasks done or blocked)
	 */
	private checkPlanCompletion(): void {
		if (!this.plan) return;

		const hasInProgress = this.plan.tasks.some(t => t.status === 'in_progress');
		const hasPending = this.plan.tasks.some(t => t.status === 'pending');

		if (hasInProgress || hasPending) {
			return; // Still work to do
		}

		// All tasks are in a terminal state
		const hasFailed = this.plan.tasks.some(
			t => t.status === 'failed' || t.status === 'blocked',
		);

		if (hasFailed) {
			this.plan.status = 'failed';
			this.emit({
				type: 'plan_failed',
				plan: this.plan,
				error: 'One or more tasks failed',
			});
		} else {
			this.plan.status = 'completed';
			this.emit({type: 'plan_completed', plan: this.plan});
		}
	}
}
