import type React from 'react';
import {
	ErrorMessage,
	InfoMessage,
	WarningMessage,
} from '@/components/message-box';
import type {MessageType} from '@/types/index';
import {setGlobalMessageQueueWithRenderer} from '@/utils/message-queue-core';

// The queue itself lives in the React-free core so non-UI modules can log
// without loading Ink. This module adds only the Ink rendering.
export * from '@/utils/message-queue-core';

function renderMessage(
	type: MessageType,
	message: string,
	hideBox: boolean,
	key: string,
): React.ReactNode {
	switch (type) {
		case 'error':
			return <ErrorMessage key={key} message={message} hideBox={hideBox} />;
		case 'warning':
			return <WarningMessage key={key} message={message} hideBox={hideBox} />;
		default:
			return <InfoMessage key={key} message={message} hideBox={hideBox} />;
	}
}

// Set the global chat queue function
export function setGlobalMessageQueue(
	addToChatQueue: (component: React.ReactNode) => void,
) {
	setGlobalMessageQueueWithRenderer(addToChatQueue, renderMessage);
}
