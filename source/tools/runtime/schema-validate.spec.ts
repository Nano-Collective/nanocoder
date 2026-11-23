import test from 'ava';
import {jsonSchema, tool} from '@/types/core';
import {
	getToolJsonSchema,
	validateArgsAgainstSchema,
} from './schema-validate.js';

const askSchema = {
	type: 'object',
	properties: {
		question: {type: 'string'},
		options: {type: 'array', items: {type: 'string'}},
		allowFreeform: {type: 'boolean'},
	},
	required: ['question', 'options'],
};

const fileOpSchema = {
	type: 'object',
	properties: {
		operation: {type: 'string', enum: ['delete', 'move', 'copy', 'mkdir']},
		path: {type: 'string'},
		destination: {type: 'string'},
	},
	required: ['operation', 'path'],
};

// ============================================================================
// Well-typed args → no errors
// ============================================================================

test('accepts correctly typed args', t => {
	t.deepEqual(
		validateArgsAgainstSchema(
			{question: 'Pick one', options: ['A', 'B'], allowFreeform: true},
			askSchema,
		),
		[],
	);
});

test('lenient on scalar-vs-scalar (numeric string for... still scalar)', t => {
	// A model sending a number where a string is declared is tolerated — only
	// structured values are flagged.
	t.deepEqual(
		validateArgsAgainstSchema({question: 42, options: ['A', 'B']}, askSchema),
		[],
	);
});

test('does not flag missing required fields (left to per-tool validators)', t => {
	t.deepEqual(validateArgsAgainstSchema({options: ['A', 'B']}, askSchema), []);
});

// ============================================================================
// Structured-where-scalar → flagged (the real bug class)
// ============================================================================

test('flags an object where a string is expected', t => {
	const errors = validateArgsAgainstSchema(
		{question: {description: 'x'}, options: ['A', 'B']},
		askSchema,
	);
	t.is(errors.length, 1);
	t.is(errors[0].path, 'question');
	t.is(errors[0].received, 'object');
});

test('flags object elements in a string array (the ask_user options bug)', t => {
	const errors = validateArgsAgainstSchema(
		{question: 'Pick', options: [{label: 'A', value: 'a'}, {label: 'B'}]},
		askSchema,
	);
	t.is(errors.length, 2);
	t.is(errors[0].path, 'options[0]');
	t.is(errors[0].received, 'object');
	t.is(errors[1].path, 'options[1]');
});

test('flags a non-array where an array is expected', t => {
	const errors = validateArgsAgainstSchema(
		{question: 'Pick', options: 'A'},
		askSchema,
	);
	t.is(errors.length, 1);
	t.is(errors[0].path, 'options');
	t.is(errors[0].expected, 'array');
});

test('flags an enum violation', t => {
	const errors = validateArgsAgainstSchema(
		{operation: 'remove', path: 'a.txt'},
		fileOpSchema,
	);
	t.is(errors.length, 1);
	t.is(errors[0].path, 'operation');
	t.regex(String(errors[0].expected), /one of/);
});

test('flags an object where the path string is expected', t => {
	const errors = validateArgsAgainstSchema(
		{operation: 'delete', path: {nested: true}},
		fileOpSchema,
	);
	t.is(errors.length, 1);
	t.is(errors[0].path, 'path');
});

// ============================================================================
// Edge cases — never throw / never false-positive on unknown shapes
// ============================================================================

test('returns no errors when schema is undefined', t => {
	t.deepEqual(validateArgsAgainstSchema({anything: 1}, undefined), []);
});

test('ignores properties not declared in the schema', t => {
	t.deepEqual(
		validateArgsAgainstSchema(
			{question: 'Pick', options: ['A', 'B'], extra: {a: 1}},
			askSchema,
		),
		[],
	);
});

// ============================================================================
// getToolJsonSchema — extracts the raw schema from a jsonSchema()-built tool
// ============================================================================

test('getToolJsonSchema pulls the raw schema off an AI SDK tool', t => {
	const t1 = tool({
		description: 'x',
		inputSchema: jsonSchema<{path: string}>({
			type: 'object',
			properties: {path: {type: 'string'}},
			required: ['path'],
		}),
	});
	const schema = getToolJsonSchema(t1);
	t.truthy(schema);
	t.is(schema?.type, 'object');
	t.truthy(schema?.properties?.path);
});

test('getToolJsonSchema returns undefined for non-tools', t => {
	t.is(getToolJsonSchema(undefined), undefined);
	t.is(getToolJsonSchema({}), undefined);
	t.is(getToolJsonSchema({inputSchema: {}}), undefined);
});
