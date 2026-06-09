import test from 'ava';
import type {ToolHandler, ToolValidator} from '@/types/core';
import {
	ToolValidationError,
	formatValidationError,
	toolErrorToContent,
	withValidation,
} from './tool-validation';

test('withValidation returns the handler unchanged when there is no validator', t => {
	const handler: ToolHandler = async () => 'ok';
	t.is(withValidation(handler), handler);
});

test('withValidation runs the handler when validation passes', async t => {
	const handler: ToolHandler = async () => 'ran';
	const validator: ToolValidator = async () => ({valid: true});
	const wrapped = withValidation(handler, validator);
	t.is(await wrapped({}), 'ran');
});

test('withValidation throws ToolValidationError and skips the handler on failure', async t => {
	let handlerRan = false;
	const handler: ToolHandler = async () => {
		handlerRan = true;
		return 'ran';
	};
	const validator: ToolValidator = async () => ({
		valid: false,
		error: 'bad args',
		details: [{path: 'x', expected: 'string', received: 'number'}],
	});
	const wrapped = withValidation(handler, validator);

	const err = await t.throwsAsync(() => wrapped({x: 1}), {
		instanceOf: ToolValidationError,
	});
	t.false(handlerRan, 'handler must not run when validation fails');
	t.deepEqual(err?.details, [
		{path: 'x', expected: 'string', received: 'number'},
	]);
});

test('withValidation type-checks args against the schema before the handler', async t => {
	let handlerRan = false;
	const handler: ToolHandler = async () => {
		handlerRan = true;
		return 'ran';
	};
	const schema = {
		type: 'object',
		properties: {path: {type: 'string'}},
	};
	const wrapped = withValidation(handler, undefined, schema);

	// Object where a string is expected → rejected before the handler runs.
	const err = await t.throwsAsync(() => wrapped({path: {nested: true}}), {
		instanceOf: ToolValidationError,
	});
	t.false(handlerRan, 'handler must not run on a type error');
	t.is(err?.details?.[0]?.path, 'path');
	t.is(err?.details?.[0]?.received, 'object');

	// Correctly typed args pass straight through.
	t.is(await wrapped({path: 'src/index.ts'}), 'ran');
});

test('formatValidationError renders structured details as lines', t => {
	const out = formatValidationError('bad args', [
		{path: 'command', expected: 'string', received: 'undefined'},
	]);
	t.true(out.includes('Validation failed: bad args'));
	t.true(out.includes('`command`: expected string, received undefined'));
});

test('formatValidationError without details is a single line', t => {
	const out = formatValidationError('bad args');
	t.is(out, '⚒ Validation failed: bad args');
});

test('toolErrorToContent formats validation errors with detail, others generically', t => {
	const validation = toolErrorToContent(
		new ToolValidationError('bad', [{path: 'p', expected: 'number'}]),
	);
	t.true(validation.includes('Validation failed: bad'));
	t.true(validation.includes('`p`: expected number'));

	const generic = toolErrorToContent(new Error('boom'));
	t.is(generic, 'Error: boom');
});
