import test from 'ava';
import type {ToolCall, ToolHandler, ToolValidator} from '@/types/core';
import {
	ToolValidationError,
	formatValidationError,
	precheckToolCall,
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

test('withValidation forwards the abort signal to the handler', async t => {
	let seen: AbortSignal | undefined;
	const handler: ToolHandler = async (_args, options) => {
		seen = options?.abortSignal;
		return 'ran';
	};
	const controller = new AbortController();

	// Validator-only wrapper.
	const validated = withValidation(handler, async () => ({valid: true}));
	await validated({}, {abortSignal: controller.signal});
	t.is(seen, controller.signal, 'a validator must not swallow the signal');

	// Schema-only wrapper — the path every tool built from a NanocoderToolExport
	// takes, so a dropped signal here makes Stop/Escape a no-op for running tools.
	seen = undefined;
	const schemaValidated = withValidation(handler, undefined, {
		type: 'object',
		properties: {path: {type: 'string'}},
	});
	await schemaValidated({path: 'a.ts'}, {abortSignal: controller.signal});
	t.is(seen, controller.signal, 'schema validation must not swallow the signal');
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

const SCHEMA_TOOL = {
	inputSchema: {
		jsonSchema: {
			type: 'object',
			properties: {path: {type: 'string'}},
		},
	},
};

function call(name: string, args: Record<string, unknown>): ToolCall {
	return {id: 'call-1', function: {name, arguments: args}};
}

test('precheckToolCall returns null when the schema and validator accept the call', async t => {
	const manager = {
		getToolEntry: () => ({tool: SCHEMA_TOOL}),
		getToolValidator: () => async () => ({valid: true as const}),
	};
	t.is(await precheckToolCall(manager, call('schema_tool', {path: 'a.txt'})), null);
});

test('precheckToolCall formats a schema mismatch and does not run the validator', async t => {
	let validatorRan = false;
	const manager = {
		getToolEntry: () => ({tool: SCHEMA_TOOL}),
		getToolValidator: () => async () => {
			validatorRan = true;
			return {valid: false as const, error: 'validator should not run'};
		},
	};
	const error = await precheckToolCall(
		manager,
		call('schema_tool', {path: {nested: true}}),
	);
	t.false(validatorRan);
	t.is(
		error,
		formatValidationError(
			'one or more arguments have the wrong type — fix the types and call the tool again',
			[{path: 'path', expected: 'string', received: 'object'}],
		),
	);
});

test('precheckToolCall formats a validator failure the way the handler would', async t => {
	const details = [{path: 'path', message: 'not readable'}];
	const manager = {
		getToolEntry: () => ({tool: SCHEMA_TOOL}),
		getToolValidator: () => async () => ({
			valid: false as const,
			error: 'path is not writable',
			details,
		}),
	};
	t.is(
		await precheckToolCall(manager, call('schema_tool', {path: 'a.txt'})),
		formatValidationError('path is not writable', details),
	);
});

test('precheckToolCall turns a throwing validator into the model-facing error', async t => {
	const manager = {
		getToolEntry: () => ({tool: SCHEMA_TOOL}),
		getToolValidator: () => async () => {
			throw new Error('validator exploded');
		},
	};
	t.is(
		await precheckToolCall(manager, call('schema_tool', {path: 'a.txt'})),
		toolErrorToContent(new Error('validator exploded')),
	);
});

test('precheckToolCall returns null when there is nothing to check', async t => {
	t.is(
		await precheckToolCall(null, call('schema_tool', {path: 'a.txt'})),
		null,
	);
	t.is(
		await precheckToolCall(
			{
				getToolEntry: () => undefined,
				getToolValidator: () => undefined,
			},
			call('schema_tool', {path: 'a.txt'}),
		),
		null,
	);
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
