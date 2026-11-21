import test from 'ava';
import {jsonSchema, tool} from '@/types/core';
import {
	getToolJsonSchema,
	validateArgsAgainstSchema,
	validateJsonDocument,
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

// ============================================================================
// validateJsonDocument — strict validation for `run --json-schema`
// ============================================================================

const reviewSchema = {
	type: 'object',
	required: ['verdict', 'issues'],
	additionalProperties: false,
	properties: {
		verdict: {type: 'string', enum: ['pass', 'fail']},
		issues: {
			type: 'array',
			items: {
				type: 'object',
				required: ['file', 'line', 'message'],
				additionalProperties: false,
				properties: {
					file: {type: 'string', minLength: 1},
					line: {type: 'integer', minimum: 1},
					message: {type: 'string'},
				},
			},
		},
	},
};

test('strict: accepts a valid document', t => {
	t.deepEqual(
		validateJsonDocument(
			{
				verdict: 'fail',
				issues: [{file: 'src/a.ts', line: 3, message: 'bug'}],
			},
			reviewSchema,
		),
		[],
	);
});

test('strict: reports missing required properties', t => {
	const errors = validateJsonDocument({verdict: 'pass'}, reviewSchema);
	t.is(errors.length, 1);
	t.is(errors[0].path, 'issues');
	t.regex(String(errors[0].message), /missing required property/);
});

test('strict: rejects extra properties when additionalProperties is false', t => {
	const errors = validateJsonDocument(
		{verdict: 'pass', issues: [], extra: true},
		reviewSchema,
	);
	t.is(errors.length, 1);
	t.is(errors[0].path, 'extra');
	t.regex(String(errors[0].message), /not allowed/);
});

test('strict: enforces integer, enum and minimum constraints', t => {
	const errors = validateJsonDocument(
		{
			verdict: 'maybe',
			issues: [{file: '', line: 0, message: 'x'}],
		},
		reviewSchema,
	);
	t.true(errors.some(error => error.path === 'verdict'));
	t.true(errors.some(error => error.path === 'issues[0].file'));
	t.true(errors.some(error => error.path === 'issues[0].line'));
});

test('strict: enforces nested types strictly', t => {
	const errors = validateJsonDocument(
		{verdict: 'pass', issues: [{file: 'a', line: '3', message: 'x'}]},
		reviewSchema,
	);
	t.is(errors.length, 1);
	t.is(errors[0].path, 'issues[0].line');
	t.is(errors[0].expected, 'integer');
	t.is(errors[0].received, 'string');
});

test('strict: supports const and local $ref', t => {
	const schema = {
		$defs: {
			issue: {
				type: 'object',
				required: ['kind'],
				properties: {kind: {const: 'bug'}},
			},
		},
		type: 'object',
		required: ['issue'],
		properties: {issue: {$ref: '#/$defs/issue'}},
	};

	t.deepEqual(validateJsonDocument({issue: {kind: 'bug'}}, schema), []);

	const errors = validateJsonDocument({issue: {kind: 'chore'}}, schema);
	t.is(errors.length, 1);
	t.is(errors[0].path, 'issue.kind');
	t.regex(String(errors[0].message), /must equal "bug"/);
});

	test('strict: reports an unresolvable $ref', t => {
	const errors = validateJsonDocument(
		{a: 'value'},
		{type: 'object', properties: {a: {$ref: '#/$defs/missing'}}},
	);
	t.is(errors.length, 1);
	t.regex(String(errors[0].message), /could not be resolved/);
});

test('strict: supports anyOf, oneOf and allOf', t => {
	const anyOf = {
		anyOf: [{type: 'string'}, {type: 'integer'}],
	};
	t.deepEqual(validateJsonDocument('ok', anyOf), []);
	t.deepEqual(validateJsonDocument(3, anyOf), []);
	t.is(validateJsonDocument(true, anyOf).length, 1);

	const oneOf = {oneOf: [{type: 'number'}, {type: 'integer'}]};
	// 3 matches both branches, which oneOf rejects.
	t.is(validateJsonDocument(3, oneOf).length, 1);
	t.deepEqual(validateJsonDocument(3.5, oneOf), []);

	const allOf = {allOf: [{type: 'string'}, {minLength: 2}]};
	t.deepEqual(validateJsonDocument('ok', allOf), []);
	t.is(validateJsonDocument('x', allOf).length, 1);
});

test('strict: enforces string, numeric and array constraints', t => {
	t.is(validateJsonDocument('ab', {type: 'string', minLength: 3}).length, 1);
	t.is(validateJsonDocument('abc', {type: 'string', maxLength: 2}).length, 1);
	t.is(
		validateJsonDocument('abc', {type: 'string', pattern: '^\\d+$'}).length,
		1,
	);
	t.deepEqual(
		validateJsonDocument('123', {type: 'string', pattern: '^\\d+$'}),
		[],
	);
	const unsupportedPattern = validateJsonDocument('aaa', {
		type: 'string',
		pattern: '^(a+)+$',
	});
	t.is(unsupportedPattern.length, 1);
	t.regex(String(unsupportedPattern[0].message), /pattern is unsupported/);
	t.deepEqual(
		validateJsonDocument('a+b', {type: 'string', pattern: '^a\\+b$'}),
		[],
	);
	const unsupportedEscape = validateJsonDocument('word', {
		type: 'string',
		pattern: '\\bword\\b',
	});
	t.regex(String(unsupportedEscape[0].message), /escape.*outside the supported/);
	t.is(validateJsonDocument(4, {type: 'number', minimum: 5}).length, 1);
	t.is(validateJsonDocument(6, {type: 'number', maximum: 5}).length, 1);
	t.is(
		validateJsonDocument(5, {type: 'number', exclusiveMinimum: 5}).length,
		1,
	);
	t.is(validateJsonDocument(7, {type: 'number', multipleOf: 2}).length, 1);
	t.is(validateJsonDocument([1], {type: 'array', minItems: 2}).length, 1);
	t.is(validateJsonDocument([1, 2, 3], {type: 'array', maxItems: 2}).length, 1);
	t.is(
		validateJsonDocument([1, 1], {type: 'array', uniqueItems: true}).length,
		1,
	);
});

test('strict: validates patternProperties with the bounded pattern matcher', t => {
	const schema = {
		type: 'object',
		patternProperties: {'^x-[a-z]+$': {type: 'integer'}},
		additionalProperties: false,
	};
	t.deepEqual(validateJsonDocument({'x-name': 3}, schema), []);
	const errors = validateJsonDocument({'x-name': 'three'}, schema);
	t.is(errors.length, 1);
	t.is(errors[0].path, 'x-name');

	const unsupported = validateJsonDocument({'x-name': 3}, {
		type: 'object',
		patternProperties: {'^(x|y)-name$': {type: 'integer'}},
	});
	t.is(unsupported.length, 1);
	t.regex(String(unsupported[0].message), /patternProperties pattern is unsupported/);
	const unsupportedWithoutProperties = validateJsonDocument({}, {
		type: 'object',
		patternProperties: {'^(x|y)-name$': {type: 'integer'}},
	});
	t.is(unsupportedWithoutProperties.length, 1);
});

test('strict: pattern matching stays bounded for long values', t => {
	t.deepEqual(
		validateJsonDocument('a'.repeat(50_000), {
			type: 'string',
			pattern: '^a+$',
		}),
		[],
	);
	const limited = validateJsonDocument('a'.repeat(100_000), {
		type: 'string',
		pattern: 'a'.repeat(256),
	});
	t.regex(String(limited[0].message), /exceeds the validation work limit/);
});

test('strict: supports tuple items and additionalItems', t => {
	const schema = {
		type: 'array',
		items: [{type: 'string'}, {type: 'integer'}],
		additionalItems: {type: 'boolean'},
	};
	t.deepEqual(validateJsonDocument(['a', 1, true], schema), []);
	const errors = validateJsonDocument(['a', 'b', 1], schema);
	t.is(errors.length, 2);
	t.is(errors[0].path, '[1]');
	t.is(errors[1].path, '[2]');
});

test('strict: supports boolean schemas', t => {
	t.deepEqual(validateJsonDocument('anything', true), []);
	t.is(validateJsonDocument('anything', false).length, 1);
});

test('strict: caps the number of reported errors', t => {
	const schema = {
		type: 'object',
		required: Array.from({length: 50}, (_, index) => `field${index}`),
	};
	const errors = validateJsonDocument({}, schema);
	t.is(errors.length, 20);
});
