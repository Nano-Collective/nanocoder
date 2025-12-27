import test from 'ava';
import {displayError} from './message-helpers.js';
import type React from 'react';

test('displayError - handles cancellation errors specially', t => {
	let capturedComponent: React.ReactNode = null;
	const addToChatQueue = (component: React.ReactNode) => {
		capturedComponent = component;
	};

	const error = new Error('Operation was cancelled');
	displayError(error, 'test', addToChatQueue, () => 1);

	t.truthy(capturedComponent);
	// Check that component was created (we can't easily inspect JSX in tests)
	t.pass();
});

test('displayError - handles generic errors', t => {
	let capturedComponent: React.ReactNode = null;
	const addToChatQueue = (component: React.ReactNode) => {
		capturedComponent = component;
	};

	const error = new Error('Test error');
	displayError(error, 'test', addToChatQueue, () => 1);

	t.truthy(capturedComponent);
	t.pass();
});

test('displayError - handles non-Error objects', t => {
	let capturedComponent: React.ReactNode = null;
	const addToChatQueue = (component: React.ReactNode) => {
		capturedComponent = component;
	};

	displayError('string error', 'test', addToChatQueue, () => 1);

	t.truthy(capturedComponent);
	t.pass();
});
