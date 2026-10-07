import test from 'ava';
import type React from 'react';

import {ErrorMessage} from '@/components/message-box';
import {displayError} from './message-helpers.js';

function captureErrorMessage(error: unknown): React.ReactElement {
	let capturedComponent: React.ReactNode = null;
	displayError(error, 'test', component => {
		capturedComponent = component;
	});

	if (!capturedComponent || typeof capturedComponent !== 'object' || !('props' in capturedComponent)) {
		throw new Error('displayError did not enqueue a React element');
	}

	return capturedComponent as React.ReactElement;
}

test('displayError - handles cancellation errors specially', t => {
	const component = captureErrorMessage(new Error('Operation was cancelled'));

	t.is(component.type, ErrorMessage);
	t.is(component.props.message, 'Interrupted by user.');
	t.true(component.props.hideBox);
});

test('displayError - formats generic errors', t => {
	const component = captureErrorMessage(new Error('Test error'));

	t.is(component.type, ErrorMessage);
	t.is(component.props.message, 'Test error');
	t.true(component.props.hideBox);
});

test('displayError - handles non-Error objects', t => {
	const component = captureErrorMessage({reason: 'string error'});

	t.is(component.type, ErrorMessage);
	t.is(component.props.message, '{"reason":"string error"}');
	t.true(component.props.hideBox);
});
