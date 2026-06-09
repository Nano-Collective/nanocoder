import type React from 'react';
import {ErrorMessage} from '@/components/message-box';
import {generateKey} from '@/session/key-generator';
import {formatError} from '@/utils/error-formatter';

/**
 * Displays an error in the chat queue with special handling for cancellation errors.
 *
 * @param error - The error to display
 * @param keyPrefix - Prefix for the React component key
 * @param addToChatQueue - Callback to add error message to chat
 */
export const displayError = (
	error: unknown,
	keyPrefix: string,
	addToChatQueue: (component: React.ReactNode) => void,
): void => {
	if (error instanceof Error && error.message === 'Operation was cancelled') {
		addToChatQueue(
			<ErrorMessage
				key={generateKey(keyPrefix)}
				message="Interrupted by user."
				hideBox={true}
			/>,
		);
	} else {
		addToChatQueue(
			<ErrorMessage
				key={generateKey(keyPrefix)}
				message={formatError(error)}
				hideBox={true}
			/>,
		);
	}
};
