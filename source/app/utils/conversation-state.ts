import type {Message, ToolCall} from '@/types/core';

interface ConversationProgress {
	originalTask: string;
	currentStep: number;
	totalEstimatedSteps: number;
	completedActions: string[];
	nextAction?: string;
	toolCallsExecuted: number;
	lastToolCall?: ToolCall;
	isRepeatingAction: boolean;
	contextSummary?: string;
}

interface ConversationState {
	progress: ConversationProgress;
	lastAssistantMessage?: Message;
	conversationStartTime: number;
	toolExecutionCount: number;
	recentToolCalls: ToolCall[];
}

export class ConversationStateManager {
	private state: ConversationState | null = null;
	private maxRecentToolCalls = 5;
	private maxCompletedActions = 10;

	/**
	 * Initialize conversation state from the first user message
	 */
	initializeState(userMessage: string): ConversationState {
		// Detect if this is a simple greeting to avoid over-interpreting
		const isSimpleGreeting = this.isSimpleGreeting(userMessage);
		this.state = {
			progress: {
				originalTask: userMessage,
				currentStep: 1,
				totalEstimatedSteps: isSimpleGreeting
					? 1
					: this.estimateSteps(userMessage),
				completedActions: [],
				toolCallsExecuted: 0,
				isRepeatingAction: false,
			},
			conversationStartTime: Date.now(),
			toolExecutionCount: 0,
			recentToolCalls: [],
		};
		return this.state;
	}

	/**
	 * Update state after tool execution
	 */
	updateAfterToolExecution(toolCall: ToolCall, result: string): void {
		if (!this.state) return;

		// Add to recent tool calls
		this.state.recentToolCalls.push(toolCall);
		if (this.state.recentToolCalls.length > this.maxRecentToolCalls) {
			this.state.recentToolCalls.shift();
		}

		// Check for repetition
		const isRepeating = this.detectRepetition(toolCall);

		// Update progress
		this.state.progress.toolCallsExecuted++;
		this.state.progress.lastToolCall = toolCall;
		this.state.progress.isRepeatingAction = isRepeating;
		this.state.progress.currentStep++;

		// Add completed action
		const actionDescription = this.describeToolAction(toolCall, result);
		this.state.progress.completedActions.push(actionDescription);
		if (
			this.state.progress.completedActions.length > this.maxCompletedActions
		) {
			this.state.progress.completedActions.shift();
		}

		// Update total estimated steps if needed
		if (
			this.state.progress.currentStep > this.state.progress.totalEstimatedSteps
		) {
			this.state.progress.totalEstimatedSteps =
				this.state.progress.currentStep + 2;
		}

		this.state.toolExecutionCount++;
	}

	/**
	 * Update assistant message in state
	 */
	updateAssistantMessage(message: Message): void {
		if (!this.state) return;
		this.state.lastAssistantMessage = message;
	}

	/**
	 * Generate context-aware continuation prompt
	 */
	generateContinuationContext(): string {
		if (!this.state) return '';

		const progress = this.state.progress;
		let context = `[Task Progress: Step ${progress.currentStep} of ~${progress.totalEstimatedSteps}]\n`;
		context += `[Original Task: "${progress.originalTask}"]\n\n`;

		if (progress.completedActions.length > 0) {
			context += `Recent actions completed:\n`;
			progress.completedActions.slice(-3).forEach((action, i) => {
				context += `${i + 1}. ${action}\n`;
			});
			context += '\n';
		}

		if (progress.isRepeatingAction) {
			context += `⚠️ Warning: You may be repeating a similar action. Consider a different approach or move to the next step.\n\n`;
		}

		// Suggest next logical step
		context += this.generateNextStepSuggestion();

		context += `Continue working toward completing: "${progress.originalTask}"`;

		return context;
	}

	/**
	 * Get current state
	 */
	getState(): ConversationState | null {
		return this.state;
	}

	/**
	 * Reset state
	 */
	reset(): void {
		this.state = null;
	}

	/**
	 * Estimate number of steps for a task
	 */
	private estimateSteps(task: string): number {
		const taskLower = task.toLowerCase();

		// Simple heuristics based on task complexity
		if (
			taskLower.includes('create') ||
			taskLower.includes('build') ||
			taskLower.includes('implement')
		) {
			return 5;
		}
		if (
			taskLower.includes('fix') ||
			taskLower.includes('debug') ||
			taskLower.includes('troubleshoot')
		) {
			return 4;
		}
		if (
			taskLower.includes('analyze') ||
			taskLower.includes('understand') ||
			taskLower.includes('explain')
		) {
			return 3;
		}
		if (
			taskLower.includes('read') ||
			taskLower.includes('show') ||
			taskLower.includes('list')
		) {
			return 2;
		}

		// Default based on length
		return Math.max(3, Math.min(8, Math.ceil(task.length / 50)));
	}

	/**
	 * Detect if the current tool call is repetitive
	 */
	private detectRepetition(toolCall: ToolCall): boolean {
		if (!this.state || this.state.recentToolCalls.length < 2) return false;

		const recentToolCalls = this.state.recentToolCalls;
		const recent = recentToolCalls.slice(-2);
		return recent.some(
			prevCall =>
				prevCall.function.name === toolCall.function.name &&
				JSON.stringify(prevCall.function.arguments) ===
					JSON.stringify(toolCall.function.arguments),
		);
	}

	/**
	 * Describe what a tool action accomplished
	 */
	private describeToolAction(toolCall: ToolCall, _result: string): string {
		const toolName = toolCall.function.name;
		const args = toolCall.function.arguments;

		const getFilename = () => {
			const filename = args.filename;
			const path = args.path;
			if (typeof filename === 'string') return filename;
			if (typeof path === 'string') return path;
			return 'unknown';
		};

		switch (toolName) {
			case 'read_file':
				return `Read file: ${getFilename()}`;
			case 'write_file':
				return `Created/wrote file: ${getFilename()}`;
			case 'string_replace':
			case 'diff_edit':
				return `Edited file: ${getFilename()}`;
			case 'execute_bash': {
				const command = args.command;
				const commandStr = typeof command === 'string' ? command : '';
				return `Executed command: ${commandStr.substring(0, 50)}${
					commandStr.length > 50 ? '...' : ''
				}`;
			}
			default:
				return `Used ${toolName}`;
		}
	}

	/**
	 * Generate intelligent next step suggestions
	 */
	private generateNextStepSuggestion(): string {
		if (!this.state) return '';

		const progress = this.state.progress;
		const lastTool = progress.lastToolCall;

		if (!lastTool) {
			return 'Consider what information you need to gather first.\n\n';
		}

		const suggestions: string[] = [];

		// Suggest logical next steps based on last tool
		switch (lastTool.function.name) {
			case 'read_file':
				suggestions.push(
					'Based on the file contents, determine what changes or analysis are needed.',
				);
				break;
			case 'execute_bash':
				suggestions.push(
					'Review the command output and decide on the next action.',
				);
				break;
			case 'write_file':
				suggestions.push(
					'Consider testing or verifying the file you just created.',
				);
				break;
			case 'string_replace':
			case 'diff_edit':
				suggestions.push(
					'Consider testing the changes or making additional modifications.',
				);
				break;
			default:
				suggestions.push('Use the tool result to inform your next action.');
		}

		// Add progress-based suggestions
		if (progress.currentStep / progress.totalEstimatedSteps > 0.7) {
			suggestions.push(
				"You're near completion - focus on finalizing and testing.",
			);
		}

		return suggestions.join(' ') + '\n\n';
	}

	/**
	 * Detect if a message is a simple greeting to avoid over-interpreting
	 */
	private isSimpleGreeting(message: string): boolean {
		const lowerMessage = message.toLowerCase().trim();
		const greetings = [
			'hi',
			'hello',
			'hey',
			'hiya',
			'howdy',
			'good morning',
			'good afternoon',
			'good evening',
			"what's up",
			'whats up',
			'sup',
			'yo',
		];

		// Check if the entire message is just a greeting (with optional punctuation)
		const cleanMessage = lowerMessage.replace(/[!?.,\s]+$/g, '');
		return (
			greetings.includes(cleanMessage) ||
			(cleanMessage.length <= 10 &&
				greetings.some(greeting => cleanMessage.includes(greeting)))
		);
	}
}
