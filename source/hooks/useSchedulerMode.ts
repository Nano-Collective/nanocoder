import React from 'react';
import {setCurrentMode as setCurrentModeContext} from '@/context/mode-context';
import {ScheduleRunner} from '@/schedule/runner';
import type {DevelopmentMode, Message} from '@/types/core';

interface UseSchedulerModeProps {
	isSchedulerMode: boolean;
	mcpInitialized: boolean;
	setDevelopmentMode: (
		updater: DevelopmentMode | ((prev: DevelopmentMode) => DevelopmentMode),
	) => void;
	handleMessageSubmit: (message: string) => Promise<void>;
	clearMessages: () => Promise<void>;
	isConversationComplete: boolean;
	isToolExecuting: boolean;
	isToolConfirmationMode: boolean;
	messages: Message[];
	addToChatQueue: (component: React.ReactNode) => void;
}

export interface SchedulerModeResult {
	schedulerRunner: ScheduleRunner | null;
	activeJobCount: number;
	queueLength: number;
	isProcessing: boolean;
	currentJobCommand: string | null;
}

/**
 * Manages scheduler mode lifecycle.
 * When isSchedulerMode becomes true, creates a ScheduleRunner, switches to scheduler dev mode,
 * and starts cron jobs. When isSchedulerMode becomes false, stops everything.
 */
export function useSchedulerMode({
	isSchedulerMode,
	mcpInitialized,
	setDevelopmentMode,
	handleMessageSubmit,
	clearMessages,
	isConversationComplete,
}: UseSchedulerModeProps): SchedulerModeResult {
	const runnerRef = React.useRef<ScheduleRunner | null>(null);
	const [activeJobCount, setActiveJobCount] = React.useState(0);
	const [queueLength, setQueueLength] = React.useState(0);
	const [isProcessing, setIsProcessing] = React.useState(false);
	const [currentJobCommand, setCurrentJobCommand] = React.useState<
		string | null
	>(null);
	const previousModeRef = React.useRef<DevelopmentMode>('normal');
	const conversationResolveRef = React.useRef<(() => void) | null>(null);

	// Resolve conversation completion promise when conversation finishes
	React.useEffect(() => {
		if (isConversationComplete && conversationResolveRef.current) {
			conversationResolveRef.current();
			conversationResolveRef.current = null;
		}
	}, [isConversationComplete]);

	// Start/stop scheduler when mode changes
	React.useEffect(() => {
		if (isSchedulerMode && mcpInitialized) {
			if (runnerRef.current) return; // Already running

			const runner = new ScheduleRunner({
				handleMessageSubmit,
				clearMessages,
				onJobStart: schedule => {
					setCurrentJobCommand(schedule.command);
					setIsProcessing(true);
					setQueueLength(runner.getQueueLength());
				},
				onJobComplete: () => {
					setCurrentJobCommand(null);
					setIsProcessing(false);
					setQueueLength(runner.getQueueLength());
				},
				onJobError: () => {
					setCurrentJobCommand(null);
					setIsProcessing(false);
					setQueueLength(runner.getQueueLength());
				},
				waitForConversationComplete: () => {
					return new Promise<void>(resolve => {
						conversationResolveRef.current = resolve;
					});
				},
			});

			runnerRef.current = runner;

			// Save current mode and switch to scheduler
			setDevelopmentMode(currentMode => {
				previousModeRef.current = currentMode;
				return 'scheduler';
			});
			setCurrentModeContext('scheduler');

			void runner.start().then(() => {
				setActiveJobCount(runner.getActiveJobCount());
			});
		}

		if (!isSchedulerMode && runnerRef.current) {
			runnerRef.current.stop();
			runnerRef.current = null;
			setActiveJobCount(0);
			setQueueLength(0);
			setIsProcessing(false);
			setCurrentJobCommand(null);

			// Restore previous mode
			setDevelopmentMode(previousModeRef.current);
			setCurrentModeContext(previousModeRef.current);
		}
	}, [
		isSchedulerMode,
		mcpInitialized,
		handleMessageSubmit,
		clearMessages,
		setDevelopmentMode,
	]);

	// Cleanup on unmount
	React.useEffect(() => {
		return () => {
			if (runnerRef.current) {
				runnerRef.current.stop();
				runnerRef.current = null;
			}
		};
	}, []);

	return {
		schedulerRunner: runnerRef.current,
		activeJobCount,
		queueLength,
		isProcessing,
		currentJobCommand,
	};
}
