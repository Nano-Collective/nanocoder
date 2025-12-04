/**
 * Planning Handler Hook
 *
 * Orchestrates the structured task planning system.
 * Wraps the existing chat handler to add planning capabilities.
 */

import React from 'react';
import type {LLMClient, Message, ToolCall} from '@/types/core';
import type {ToolManager} from '@/tools/tool-manager';
import {
	TaskStore,
	analyzeQuery,
	createTaskPlan,
	executeTask,
	shouldReplan,
	simpleReplan,
	generatePlanSummary,
	type TaskPlan,
	type Task,
	type TaskResult,
	type PlanningConfig,
	type PlanEvent,
	DEFAULT_PLANNING_CONFIG,
} from '@/agent';
import {processToolUse} from '@/message-handler';
import {displayToolResult} from '@/utils/tool-result-display';
import TaskPlanView from '@/components/task-plan-view';
import AssistantMessage from '@/components/assistant-message';
import ErrorMessage from '@/components/error-message';
import UserMessage from '@/components/user-message';

interface UsePlanningHandlerProps {
	client: LLMClient | null;
	toolManager: ToolManager | null;
	messages: Message[];
	setMessages: (messages: Message[]) => void;
	currentModel: string;
	setIsThinking: (thinking: boolean) => void;
	setIsCancelling: (cancelling: boolean) => void;
	addToChatQueue: (component: React.ReactNode) => void;
	componentKeyCounter: number;
	abortController: AbortController | null;
	setAbortController: (controller: AbortController | null) => void;
	config?: PlanningConfig;
}

interface UsePlanningHandlerReturn {
	handlePlanningMessage: (message: string) => Promise<void>;
	currentPlan: TaskPlan | null;
	taskStore: TaskStore;
	isPlanningActive: boolean;
}

/**
 * Hook for handling messages with structured task planning
 */
export function usePlanningHandler({
	client,
	toolManager,
	messages,
	setMessages,
	currentModel,
	setIsThinking,
	setIsCancelling,
	addToChatQueue,
	componentKeyCounter,
	abortController: _abortController,
	setAbortController,
	config = DEFAULT_PLANNING_CONFIG,
}: UsePlanningHandlerProps): UsePlanningHandlerReturn {
	// Task store instance
	const taskStoreRef = React.useRef<TaskStore>(new TaskStore());
	const taskStore = taskStoreRef.current;

	// Current plan state
	const [currentPlan, setCurrentPlan] = React.useState<TaskPlan | null>(null);
	const [isPlanningActive, setIsPlanningActive] = React.useState(false);

	// Subscribe to plan events for UI updates
	React.useEffect(() => {
		const unsubscribe = taskStore.subscribe((_event: PlanEvent) => {
			// Update current plan state on any change
			const plan = taskStore.getPlan();
			setCurrentPlan(plan ? {...plan} : null);
		});

		return unsubscribe;
	}, [taskStore]);

	/**
	 * Process a tool call during task execution
	 */
	const handleToolUse = async (
		toolCall: ToolCall,
	): Promise<{
		tool_call_id: string;
		role: 'tool';
		name: string;
		content: string;
	}> => {
		const result = await processToolUse(toolCall);
		return {
			tool_call_id: result.tool_call_id,
			role: 'tool' as const,
			name: result.name || toolCall.function.name,
			content: result.content || '',
		};
	};

	/**
	 * Execute a single task and return result (no display)
	 */
	const runTask = async (
		task: Task,
		signal?: AbortSignal,
	): Promise<TaskResult> => {
		if (!client || !toolManager) {
			throw new Error('Client or tool manager not available');
		}

		// Callback to display tool results as they happen
		const onToolResult = async (
			toolCall: ToolCall,
			result: {
				tool_call_id: string;
				role: 'tool';
				name: string;
				content: string;
			},
		): Promise<void> => {
			await displayToolResult(
				toolCall,
				result,
				toolManager,
				addToChatQueue,
				componentKeyCounter,
			);
		};

		return await executeTask(
			client,
			toolManager,
			taskStore,
			task,
			handleToolUse,
			signal,
			onToolResult,
		);
	};

	/**
	 * Display task result
	 */
	const displayTaskResult = (task: Task, result: TaskResult): void => {
		if (result.success) {
			addToChatQueue(
				<AssistantMessage
					key={`task-result-${task.id}-${componentKeyCounter}`}
					message={result.output || result.summary}
					model={currentModel}
				/>,
			);
		} else {
			addToChatQueue(
				<ErrorMessage
					key={`task-error-${task.id}-${componentKeyCounter}`}
					message={`**${task.title}** failed: ${
						result.error || 'Unknown error'
					}`}
					hideBox={true}
				/>,
			);
		}
	};

	/**
	 * Execute all tasks in the plan sequentially
	 */
	const executePlan = async (signal?: AbortSignal): Promise<void> => {
		while (taskStore.hasNextTask()) {
			// Check for cancellation
			if (signal?.aborted) {
				throw new Error('Operation was cancelled');
			}

			const task = taskStore.getNextTask();
			if (!task) break;

			// Show plan with task as in_progress
			const plan = taskStore.getPlan();
			if (plan) {
				addToChatQueue(
					<TaskPlanView
						key={`plan-view-${plan.id}-${task.id}-${componentKeyCounter}`}
						plan={plan}
					/>,
				);
			}

			// Execute the task
			const result = await runTask(task, signal);

			// Show updated plan with task completed (before output)
			const updatedPlan = taskStore.getPlan();
			if (updatedPlan) {
				addToChatQueue(
					<TaskPlanView
						key={`plan-view-${updatedPlan.id}-${task.id}-done-${componentKeyCounter}`}
						plan={updatedPlan}
					/>,
				);
			}

			// Now show the task output
			displayTaskResult(task, result);

			// Check if replanning is needed
			if (shouldReplan(taskStore)) {
				const replanResult = simpleReplan(taskStore);
				if (!replanResult.canProceed) {
					break;
				}
			}
		}
	};

	/**
	 * Handle a message with structured planning
	 * Always creates a plan, even for simple queries (1 task)
	 */
	const handlePlanningMessage = async (message: string): Promise<void> => {
		if (!client || !toolManager) return;

		// Display user message
		addToChatQueue(
			<UserMessage key={`user-${componentKeyCounter}`} message={message} />,
		);

		// Add to message history
		const userMessage: Message = {role: 'user', content: message};
		const updatedMessages = [...messages, userMessage];
		setMessages(updatedMessages);

		// Create abort controller
		const controller = new AbortController();
		setAbortController(controller);

		setIsThinking(true);
		setIsPlanningActive(true);

		try {
			// Analyze the query to get task type and context
			const analysis = analyzeQuery(message);

			// Create a plan
			addToChatQueue(
				<AssistantMessage
					key={`planning-${componentKeyCounter}`}
					message="Creating a plan for this task..."
					model={currentModel}
				/>,
			);

			const plan = await createTaskPlan(
				client,
				taskStore,
				message,
				analysis,
				config,
				controller.signal,
			);

			// Execute all tasks (plan view is shown inside executePlan)
			await executePlan(controller.signal);

			// Only show summary for multi-task plans (single-task already shows full output)
			if (plan.tasks.length > 1) {
				const completedTasks = plan.tasks.filter(t => t.status === 'completed');
				const failedTasks = plan.tasks.filter(
					t => t.status === 'failed' || t.status === 'blocked',
				);

				const summary = generatePlanSummary(
					plan.originalGoal,
					completedTasks,
					failedTasks,
				);

				addToChatQueue(
					<AssistantMessage
						key={`summary-${plan.id}-${componentKeyCounter}`}
						message={summary}
						model={currentModel}
					/>,
				);
			}
		} catch (error) {
			if (
				error instanceof Error &&
				error.message === 'Operation was cancelled'
			) {
				addToChatQueue(
					<ErrorMessage
						key={`cancelled-${componentKeyCounter}`}
						message="Planning cancelled by user"
						hideBox={true}
					/>,
				);
			} else {
				const errorMsg =
					error instanceof Error ? error.message : 'Unknown error';
				addToChatQueue(
					<ErrorMessage
						key={`error-${componentKeyCounter}`}
						message={`Planning error: ${errorMsg}`}
						hideBox={true}
					/>,
				);
			}
		} finally {
			setIsThinking(false);
			setIsCancelling(false);
			setAbortController(null);
			setIsPlanningActive(false);

			// Clear the task store for next plan
			taskStore.clear();
			setCurrentPlan(null);
		}
	};

	return {
		handlePlanningMessage,
		currentPlan,
		taskStore,
		isPlanningActive,
	};
}
