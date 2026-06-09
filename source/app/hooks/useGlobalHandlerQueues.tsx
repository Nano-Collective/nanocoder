import {useCallback, useEffect, useRef, useState} from 'react';
import {
	type PendingQuestion,
	setGlobalQuestionHandler,
} from '@/utils/question-queue';
import {
	type PendingToolApproval,
	setGlobalToolApprovalHandler,
} from '@/utils/tool-approval-queue';
import {
	type PendingToolConfirmation,
	setGlobalToolConfirmHandler,
} from '@/utils/tool-confirm-queue';

interface UseGlobalHandlerQueuesProps {
	setPendingQuestion: (question: PendingQuestion | null) => void;
	setIsQuestionMode: (mode: boolean) => void;
}

interface GlobalHandlerQueues {
	handleQuestionAnswer: (answer: string) => void;
	pendingSubagentApproval: PendingToolApproval | null;
	handleSubagentToolApproval: (confirmed: boolean) => void;
	pendingToolConfirmation: PendingToolConfirmation | null;
	handleToolConfirmation: (confirmed: boolean) => void;
}

/**
 * Wires the two global "ask the user" queues into the React tree:
 *  - question-queue (ask_question tool) drives the question prompt UI
 *  - tool-approval-queue (subagent tool calls) drives a parallel approval flow
 *
 * The tool-approval queue uses a dedicated state slot so it doesn't conflict
 * with the main agent's tool confirmation flow — a subagent's tool can need
 * approval while the parent agent is mid-conversation.
 */
export function useGlobalHandlerQueues({
	setPendingQuestion,
	setIsQuestionMode,
}: UseGlobalHandlerQueuesProps): GlobalHandlerQueues {
	const questionResolverRef = useRef<((answer: string) => void) | null>(null);

	useEffect(() => {
		setGlobalQuestionHandler((question: PendingQuestion) => {
			return new Promise<string>(resolve => {
				questionResolverRef.current = resolve;
				setPendingQuestion(question);
				setIsQuestionMode(true);
			});
		});
	}, [setPendingQuestion, setIsQuestionMode]);

	const handleQuestionAnswer = useCallback(
		(answer: string) => {
			if (questionResolverRef.current) {
				questionResolverRef.current(answer);
				questionResolverRef.current = null;
			}
			setIsQuestionMode(false);
			setPendingQuestion(null);
		},
		[setIsQuestionMode, setPendingQuestion],
	);

	const toolApprovalResolverRef = useRef<((approved: boolean) => void) | null>(
		null,
	);
	const [pendingSubagentApproval, setPendingSubagentApproval] =
		useState<PendingToolApproval | null>(null);

	useEffect(() => {
		setGlobalToolApprovalHandler((approval: PendingToolApproval) => {
			return new Promise<boolean>(resolve => {
				toolApprovalResolverRef.current = resolve;
				setPendingSubagentApproval(approval);
				// Don't clear the live component — AgentProgress renders above the
				// chat input, ToolConfirmation renders below. They coexist.
			});
		});
	}, []);

	const handleSubagentToolApproval = useCallback((confirmed: boolean) => {
		if (toolApprovalResolverRef.current) {
			toolApprovalResolverRef.current(confirmed);
			toolApprovalResolverRef.current = null;
		}
		setPendingSubagentApproval(null);
	}, []);

	// Main agent tool confirmation: the conversation loop suspends on
	// signalToolConfirm() until the user approves/declines here.
	const toolConfirmResolverRef = useRef<((approved: boolean) => void) | null>(
		null,
	);
	const [pendingToolConfirmation, setPendingToolConfirmation] =
		useState<PendingToolConfirmation | null>(null);

	useEffect(() => {
		setGlobalToolConfirmHandler((confirmation: PendingToolConfirmation) => {
			return new Promise<boolean>(resolve => {
				toolConfirmResolverRef.current = resolve;
				setPendingToolConfirmation(confirmation);
			});
		});
	}, []);

	const handleToolConfirmation = useCallback((confirmed: boolean) => {
		if (toolConfirmResolverRef.current) {
			toolConfirmResolverRef.current(confirmed);
			toolConfirmResolverRef.current = null;
		}
		setPendingToolConfirmation(null);
	}, []);

	return {
		handleQuestionAnswer,
		pendingSubagentApproval,
		handleSubagentToolApproval,
		pendingToolConfirmation,
		handleToolConfirmation,
	};
}
