import {ErrorMessage} from '@/components/message-box';
import {formatError} from '@/utils/error-formatter';
import type React from 'react';

/**
 * Displays an error in the chat queue with special handling for cancellation errors.
 *
 * @param error - The error to display
 * @param keyPrefix - Prefix for the React component key
 * @param addToChatQueue - Callback to add error message to chat
 * @param getNextComponentKey - Function to generate unique React keys
 */
export const displayError = (
	error: unknown,
	keyPrefix: string,
	addToChatQueue: (component: React.ReactNode) => void,
	getNextComponentKey: () => number,
): void => {
	if (error instanceof Error && error.message === 'Operation was cancelled') {
		addToChatQueue(
			<ErrorMessage
				key={`${keyPrefix}-${getNextComponentKey()}`}
				message="Interrupted by user."
				hideBox={true}
			/>,
		);
	} else {
		addToChatQueue(
			<ErrorMessage
				key={`${keyPrefix}-${getNextComponentKey()}`}
				message={formatError(error)}
				hideBox={true}
			/>,
		);
	}
};
