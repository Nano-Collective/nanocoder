import test from 'ava';
import React from 'react';
import {ideCommand} from './ide';

console.log('\nide.spec.tsx');

test('ideCommand has correct name', t => {
	t.is(ideCommand.name, 'ide');
});

test('ideCommand has a description', t => {
	t.truthy(ideCommand.description);
	t.is(typeof ideCommand.description, 'string');
	t.is(ideCommand.description, 'Connect to an IDE');
});

test('ideCommand has a handler function', t => {
	t.is(typeof ideCommand.handler, 'function');
});

test('ideCommand handler returns a React element', async t => {
	const result = await ideCommand.handler([]);
	t.truthy(React.isValidElement(result));
});

test('ideCommand handler returns a Fragment (stub for special handling)', async t => {
	const result = await ideCommand.handler([]);
	t.truthy(result);
	// The handler returns React.Fragment since actual logic is in app-util.ts
	if (React.isValidElement(result)) {
		t.is(result.type, React.Fragment);
	}
});
