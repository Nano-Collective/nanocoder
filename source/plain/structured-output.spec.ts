import {mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'ava';
import {
	describeStructuredOutputFailure,
	loadJsonSchema,
	parseJsonDocument,
	schemaCorrectionMessage,
	schemaInstruction,
	validateStructuredOutput,
} from './structured-output.js';

const schema = {
	type: 'object',
	required: ['ok'],
	properties: {ok: {type: 'boolean'}},
} as const;

test('loads and compiles inline JSON Schema', async t => {
	t.deepEqual(await loadJsonSchema(JSON.stringify(schema)), schema);
});

test('loads and compiles a schema file', async t => {
	const directory = mkdtempSync(join(tmpdir(), 'nanocoder-schema-'));
	const file = join(directory, 'schema.json');
	try {
		writeFileSync(file, JSON.stringify(schema));
		t.deepEqual(await loadJsonSchema(file), schema);
	} finally {
		rmSync(directory, {recursive: true, force: true});
	}
});

test('a UTF-8 BOM in a schema file is ignored', async t => {
	const directory = mkdtempSync(join(tmpdir(), 'nanocoder-schema-'));
	const file = join(directory, 'schema.json');
	try {
		writeFileSync(file, `\uFEFF${JSON.stringify(schema)}`);
		t.deepEqual(await loadJsonSchema(file), schema);
	} finally {
		rmSync(directory, {recursive: true, force: true});
	}
});

test('rejects an empty value', async t => {
	await t.throwsAsync(loadJsonSchema('  '), {message: /requires a schema/});
});

test('reports a missing schema file', async t => {
	await t.throwsAsync(loadJsonSchema('definitely-missing-schema.json'), {
		message: /Could not read --json-schema file/,
	});
});

test('reports invalid inline JSON', async t => {
	await t.throwsAsync(loadJsonSchema('{"type":'), {
		message: /Could not parse --json-schema inline JSON/,
	});
});

test('reports invalid JSON in a schema file', async t => {
	const directory = mkdtempSync(join(tmpdir(), 'nanocoder-schema-'));
	const file = join(directory, 'schema.json');
	try {
		writeFileSync(file, 'not json');
		await t.throwsAsync(loadJsonSchema(file), {
			message: /Could not parse --json-schema file/,
		});
	} finally {
		rmSync(directory, {recursive: true, force: true});
	}
});

test('rejects a non-object schema root', async t => {
	await t.throwsAsync(loadJsonSchema('[1,2]'), {message: /JSON object at the root/});
	await t.throwsAsync(loadJsonSchema('"object"'), {
		message: /Could not read --json-schema file/,
	});
});

test('rejects an invalid schema before a model run', async t => {
	await t.throwsAsync(loadJsonSchema('{"type":"strin"}'), {
		message: /Invalid --json-schema/,
	});
});

test('parses a plain JSON document', t => {
	t.deepEqual(parseJsonDocument('{"ok":true}'), {
		ok: true,
		value: {ok: true},
	});
});

test('strips one surrounding markdown fence', t => {
	t.deepEqual(parseJsonDocument('```json\n{"ok":true}\n```'), {
		ok: true,
		value: {ok: true},
	});
});

test('rejects prose around the document', t => {
	const result = parseJsonDocument('Here is the answer: {"ok":true}');
	t.false(result.ok);
	if (!result.ok) t.regex(result.error, /Unexpected|JSON/);
});

test('rejects an empty answer', t => {
	const result = parseJsonDocument('   ');
	t.false(result.ok);
});

test('validates a document and reports paths', async t => {
	const good = await validateStructuredOutput('{"ok":true}', schema);
	t.true(good.ok);
	t.deepEqual(good.value, {ok: true});

	const bad = await validateStructuredOutput('{"ok":"yes"}', schema);
	t.false(bad.ok);
	t.is(bad.errors.length, 1);
	t.is(bad.errors[0].path, 'ok');
});

test('describes parse and validation failures', async t => {
	t.regex(
		describeStructuredOutputFailure(
			await validateStructuredOutput('not json', schema),
		),
		/not a single valid JSON document/,
	);
	t.regex(
		describeStructuredOutputFailure(
			await validateStructuredOutput('{"ok":"yes"}', schema),
		),
		/ok: must be boolean/,
	);
});

test('validates pattern alternation with Ajv', async t => {
	const result = await validateStructuredOutput('"pass"', {
		type: 'string',
		pattern: '^(pass|fail)$',
	});
	t.true(result.ok);
});

test('validates conditional schemas with Ajv', async t => {
	const conditionalSchema = {
		type: 'object',
		properties: {
			kind: {enum: ['number', 'text']},
			value: {},
		},
		if: {properties: {kind: {const: 'number'}}, required: ['kind']},
		then: {properties: {value: {type: 'number'}}, required: ['value']},
	};
	const valid = await validateStructuredOutput(
		'{"kind":"number","value":0.3}',
		conditionalSchema,
	);
	t.true(valid.ok);
	const invalid = await validateStructuredOutput(
		'{"kind":"number","value":"0.3"}',
		conditionalSchema,
	);
	t.false(invalid.ok);
});

test('validates multipleOf using Ajv decimal handling', async t => {
	const result = await validateStructuredOutput('0.3', {
		type: 'number',
		multipleOf: 0.1,
	});
	t.true(result.ok);
});

test('enforces propertyNames and contains keywords', async t => {
	const schema = {
		type: 'object',
		propertyNames: {pattern: '^[a-z]+$'},
		properties: {
			labels: {type: 'array', contains: {const: 'required'}},
		},
	};
	const valid = await validateStructuredOutput(
		'{"labels":["optional","required"]}',
		schema,
	);
	t.true(valid.ok);
	const invalid = await validateStructuredOutput(
		'{"Bad-Key":["optional"]}',
		schema,
	);
	t.false(invalid.ok);
});

test('the correction message asks for one bare JSON document', t => {
	const message = schemaCorrectionMessage('ok: expected boolean');
	t.regex(message, /did not validate/);
	t.regex(message, /ok: expected boolean/);
	t.regex(message, /only one JSON document/);
});

test('the system instruction embeds the schema', t => {
	const instruction = schemaInstruction(schema);
	t.regex(instruction, /## Structured output/);
	t.regex(instruction, /"required": \[/);
	t.regex(instruction, /no markdown code fences/);
});
