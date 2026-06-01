/**
 * Factory helpers for the most common chat-queue message shape:
 * `React.createElement(<X>Message, {key: generateKey(hint), message, hideBox: true})`.
 *
 * This pattern appears dozens of times across command and handler code; the
 * helpers collapse it to `errorMsg(message, hint)` etc. while keeping the
 * per-call `key` hint (passed to `generateKey`) for stable React keys.
 */

import React from 'react';
import {
	ErrorMessage,
	InfoMessage,
	SuccessMessage,
	WarningMessage,
} from '@/components/message-box';
import {generateKey} from '@/session/key-generator';

type MessageComponent = (props: {
	message: string;
	hideBox?: boolean;
}) => React.ReactElement | null;

function makeMessageFactory(Component: MessageComponent) {
	return (message: string, keyHint: string): React.ReactElement =>
		React.createElement(Component, {
			key: generateKey(keyHint),
			message,
			hideBox: true,
		});
}

export const errorMsg = makeMessageFactory(ErrorMessage);
export const successMsg = makeMessageFactory(SuccessMessage);
export const warningMsg = makeMessageFactory(WarningMessage);
export const infoMsg = makeMessageFactory(InfoMessage);
