import React from 'react';
import type {ImageAttachment} from '@/types/core';
import type {InputState} from '@/types/hooks';

export interface QueuedUserMessage {
	id: string;
	message: string;
	displayValue: string;
	images?: ImageAttachment[];
	inputState?: InputState;
}

export type UserMessageQueueDraft = Omit<QueuedUserMessage, 'id'>;

export function useUserMessageQueue() {
	const [queuedMessages, setQueuedMessages] = React.useState<
		QueuedUserMessage[]
	>([]);
	const queuedMessagesRef = React.useRef<QueuedUserMessage[]>([]);
	const nextIdRef = React.useRef(0);

	const setQueue = React.useCallback((next: QueuedUserMessage[]) => {
		queuedMessagesRef.current = next;
		setQueuedMessages(next);
	}, []);

	const enqueueMessage = React.useCallback(
		(message: UserMessageQueueDraft) => {
			const queuedMessage: QueuedUserMessage = {
				...message,
				id: `queued-user-${nextIdRef.current++}`,
			};
			setQueue([...queuedMessagesRef.current, queuedMessage]);
			return queuedMessage;
		},
		[setQueue],
	);

	const removeMessage = React.useCallback(
		(id: string) => {
			setQueue(queuedMessagesRef.current.filter(message => message.id !== id));
		},
		[setQueue],
	);

	const drainNextMessage = React.useCallback(
		async (
			dispatch: (message: QueuedUserMessage) => boolean | Promise<boolean>,
		) => {
			const [nextMessage, ...remainingMessages] = queuedMessagesRef.current;
			if (!nextMessage) return false;

			setQueue(remainingMessages);

			try {
				if (await dispatch(nextMessage)) return true;
			} catch {
				// If dispatch never started cleanly, put the message back at the
				// front so it can be retried after the next turn.
			}

			setQueue([nextMessage, ...queuedMessagesRef.current]);
			return false;
		},
		[setQueue],
	);

	return {
		queuedMessages,
		enqueueMessage,
		removeMessage,
		drainNextMessage,
	};
}
