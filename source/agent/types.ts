/**
 * Structured Task Planning Types
 *
 * Core type definitions for the plan-and-execute agent architecture.
 */

import type {ToolCall} from '@/types/core';

// ============================================================================
// Query Analysis
// ============================================================================

/**
 * Result of analyzing a user query to determine handling strategy
 */
export interface QueryAnalysis {
	/** Classification of what kind of task this is */
	taskType:
		| 'question'
		| 'implementation'
		| 'debugging'
		| 'refactoring'
		| 'research'
		| 'other';

	/** Files or context mentioned in the query */
	requiredContext: string[];
}

// ============================================================================
// Task Definitions
// ============================================================================

/**
 * Definition of a task before execution begins
 */
export interface TaskDefinition {
	/** Unique identifier for the task */
	id: string;

	/** Short, descriptive title */
	title: string;

	/** Detailed description of what needs to be done */
	description: string;

	/** Verifiable criteria for task completion */
	acceptanceCriteria: string[];

	/** IDs of tasks that must complete before this one */
	dependencies: string[];

	/** Tools likely needed for this task */
	requiredTools: string[];
}

/**
 * Current status of a task in the execution lifecycle
 */
export type TaskStatus =
	| 'pending'
	| 'in_progress'
	| 'completed'
	| 'failed'
	| 'blocked'
	| 'skipped';

/**
 * Context accumulated during task execution
 */
export interface TaskContext {
	/** Files that were read during this task */
	filesRead: string[];

	/** Files that were created or modified */
	filesModified: string[];

	/** Key findings discovered during execution */
	discoveries: string[];

	/** Decisions made during execution */
	decisions: string[];
}

/**
 * Result of executing a task
 */
export interface TaskResult {
	/** Whether the task completed successfully */
	success: boolean;

	/** Brief summary of what was accomplished */
	summary: string;

	/** Detailed output or notes */
	output?: string;

	/** Key information to pass to dependent tasks */
	passToNext: string[];

	/** Error message if task failed */
	error?: string;
}

/**
 * A task with full execution state
 */
export interface Task extends TaskDefinition {
	/** Current execution status */
	status: TaskStatus;

	/** Timestamp when task started executing */
	startedAt?: number;

	/** Timestamp when task completed */
	completedAt?: number;

	/** Result after execution */
	result?: TaskResult;

	/** Context accumulated during execution */
	context: TaskContext;
}

// ============================================================================
// Task Plan
// ============================================================================

/**
 * A complete plan for executing a user's request
 */
export interface TaskPlan {
	/** Unique identifier for this plan */
	id: string;

	/** The original user query that spawned this plan */
	originalGoal: string;

	/** All tasks in this plan */
	tasks: Task[];

	/** Task IDs in execution order (topologically sorted) */
	executionOrder: string[];

	/** When the plan was created */
	createdAt: number;

	/** Current status of the overall plan */
	status: 'planning' | 'executing' | 'completed' | 'failed';
}

// ============================================================================
// Execution Context (internal use)
// ============================================================================

/**
 * File content provided as context
 */
export interface FileContent {
	path: string;
	content: string;
	truncated: boolean;
}

/**
 * Context provided to the executor for a single task
 */
export interface TaskExecutionContext {
	task: Task;
	originalGoal: string;
	previousResults: TaskResult[];
	accumulatedDiscoveries: string[];
	accumulatedDecisions: string[];
	relevantFiles: FileContent[];
}

/**
 * Accumulated context from all completed tasks
 */
export interface AccumulatedContext {
	originalGoal: string;
	discoveries: string[];
	decisions: string[];
	filesRead: string[];
	filesModified: string[];
	taskSummaries: Array<{taskId: string; title: string; summary: string}>;
}

/**
 * Record of a tool call made during task execution
 */
export interface TrackedToolCall {
	toolCall: ToolCall;
	result: string;
	success: boolean;
	timestamp: number;
}

// ============================================================================
// Configuration
// ============================================================================

/**
 * Configuration for the planning system
 */
export interface PlanningConfig {
	/** Whether structured planning is enabled */
	enabled: boolean;

	/** Maximum number of tasks in a single plan */
	maxTasksPerPlan: number;
}

/**
 * Default planning configuration
 */
export const DEFAULT_PLANNING_CONFIG: PlanningConfig = {
	enabled: true,
	maxTasksPerPlan: 20,
};

// ============================================================================
// Events
// ============================================================================

/**
 * Events emitted during plan execution
 */
export type PlanEvent =
	| {type: 'plan_created'; plan: TaskPlan}
	| {type: 'task_started'; task: Task}
	| {type: 'task_completed'; task: Task; result: TaskResult}
	| {type: 'task_failed'; task: Task; error: string}
	| {type: 'plan_completed'; plan: TaskPlan}
	| {type: 'plan_failed'; plan: TaskPlan; error: string}
	| {type: 'replanning'; reason: string}
	| {type: 'plan_updated'; plan: TaskPlan};

/**
 * Callback for plan events
 */
export type PlanEventHandler = (event: PlanEvent) => void;
