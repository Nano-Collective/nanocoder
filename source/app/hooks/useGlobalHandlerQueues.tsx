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

/** One waiting caller: what to put on screen, and the resolver that unblocks it. */
interface QueuedRequest<TInput, TResult> {
	input: TInput;
	resolve: (result: TResult) => void;
}

/**
 * Backs one "ask the user" slot with a FIFO rather than a single resolver.
 *
 * These slots are process-wide and their callers are concurrent: `tool-executor`
 * starts up to `MAX_CONCURRENT_AGENTS` subagents in one turn, and each can ask
 * for approval. Holding a single resolver meant a second caller overwrote the
 * first, whose promise then never settled — and because the batch is awaited
 * with `Promise.allSettled`, the turn never ended and Escape could not free it.
 *
 * Requests queue in arrival order. `present` renders the head; answering it
 * resolves that caller and advances to the next, so every caller settles once
 * and none is stranded.
 */
function useHandlerQueue<TInput, TResult>(
	install: (handler: (input: TInput) => Promise<TResult>) => unknown,
	present: (next: TInput | null) => void,
): (result: TResult) => void {
	const queueRef = useRef<QueuedRequest<TInput, TResult>[]>([]);

	// `present` closes over props for the question slot, so it is read through a
	// ref: the handler below is installed once and must not capture a stale one.
	const presentRef = useRef(present);
	useEffect(() => {
		presentRef.current = present;
	}, [present]);

	useEffect(() => {
		install(
			(input: TInput) =>
				new Promise<TResult>(resolve => {
					queueRef.current.push({input, resolve});
					// Only the head is on screen; later arrivals wait their turn.
					if (queueRef.current.length === 1) {
						presentRef.current(input);
					}
				}),
		);
	}, [install]);

	// Answering with an empty queue only clears the slot, which is what the UI
	// does when it tears a prompt down.
	return useCallback((result: TResult) => {
		queueRef.current.shift()?.resolve(result);
		presentRef.current(queueRef.current[0]?.input ?? null);
	}, []);
}

/**
 * Wires the three global "ask the user" queues into the React tree:
 *  - question-queue (ask_question tool) drives the question prompt UI
 *  - tool-approval-queue (subagent tool calls) drives a parallel approval flow
 *  - tool-confirm-queue (the main agent's tool calls) drives the confirmation
 *    the conversation loop suspends on
 *
 * Each slot keeps its own queue so they never collide — a subagent's tool can
 * need approval while the parent agent is mid-conversation.
 */
export function useGlobalHandlerQueues({
	setPendingQuestion,
	setIsQuestionMode,
}: UseGlobalHandlerQueuesProps): GlobalHandlerQueues {
	const presentQuestion = useCallback(
		(next: PendingQuestion | null) => {
			setPendingQuestion(next);
			setIsQuestionMode(next !== null);
		},
		[setPendingQuestion, setIsQuestionMode],
	);
	const handleQuestionAnswer = useHandlerQueue(
		setGlobalQuestionHandler,
		presentQuestion,
	);

	// The tool-approval queue uses a dedicated state slot so it doesn't conflict
	// with the main agent's tool confirmation flow. Presenting an approval does
	// not clear the live component — AgentProgress renders above the chat input,
	// ToolConfirmation renders below. They coexist.
	const [pendingSubagentApproval, setPendingSubagentApproval] =
		useState<PendingToolApproval | null>(null);
	const handleSubagentToolApproval = useHandlerQueue(
		setGlobalToolApprovalHandler,
		setPendingSubagentApproval,
	);

	const [pendingToolConfirmation, setPendingToolConfirmation] =
		useState<PendingToolConfirmation | null>(null);
	const handleToolConfirmation = useHandlerQueue(
		setGlobalToolConfirmHandler,
		setPendingToolConfirmation,
	);

	return {
		handleQuestionAnswer,
		pendingSubagentApproval,
		handleSubagentToolApproval,
		pendingToolConfirmation,
		handleToolConfirmation,
	};
}
