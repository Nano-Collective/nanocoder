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

test('loads inline JSON', t => {
	t.deepEqual(loadJsonSchema(JSON.stringify(schema)), schema);
});

test('loads a schema file', t => {
	const directory = mkdtempSync(join(tmpdir(), 'nanocoder-schema-'));
	const file = join(directory, 'schema.json');
	try {
		writeFileSync(file, JSON.stringify(schema));
		t.deepEqual(loadJsonSchema(file), schema);
	} finally {
		rmSync(directory, {recursive: true, force: true});
	}
});

test('a UTF-8 BOM in a schema file is ignored', t => {
	const directory = mkdtempSync(join(tmpdir(), 'nanocoder-schema-'));
	const file = join(directory, 'schema.json');
	try {
		writeFileSync(file, `\uFEFF${JSON.stringify(schema)}`);
		t.deepEqual(loadJsonSchema(file), schema);
	} finally {
		rmSync(directory, {recursive: true, force: true});
	}
});

test('rejects an empty value', t => {
	t.throws(() => loadJsonSchema('  '), {message: /requires a schema/});
});

test('reports a missing schema file', t => {
	t.throws(() => loadJsonSchema('definitely-missing-schema.json'), {
		message: /Could not read --json-schema file/,
	});
});

test('reports invalid inline JSON', t => {
	t.throws(() => loadJsonSchema('{"type":'), {
		message: /Could not parse --json-schema inline JSON/,
	});
});

test('reports invalid JSON in a schema file', t => {
	const directory = mkdtempSync(join(tmpdir(), 'nanocoder-schema-'));
	const file = join(directory, 'schema.json');
	try {
		writeFileSync(file, 'not json');
		t.throws(() => loadJsonSchema(file), {
			message: /Could not parse --json-schema file/,
		});
	} finally {
		rmSync(directory, {recursive: true, force: true});
	}
});

test('rejects a non-object schema root', t => {
	t.throws(() => loadJsonSchema('[1,2]'), {message: /JSON object at the root/});
	t.throws(() => loadJsonSchema('"object"'), {
		message: /Could not read --json-schema file/,
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

test('validates a document and reports paths', t => {
	const good = validateStructuredOutput('{"ok":true}', schema);
	t.true(good.ok);
	t.deepEqual(good.value, {ok: true});

	const bad = validateStructuredOutput('{"ok":"yes"}', schema);
	t.false(bad.ok);
	t.is(bad.errors.length, 1);
	t.is(bad.errors[0].path, 'ok');
});

test('describes parse and validation failures', t => {
	t.regex(
		describeStructuredOutputFailure(
			validateStructuredOutput('not json', schema),
		),
		/not a single valid JSON document/,
	);
	t.regex(
		describeStructuredOutputFailure(
			validateStructuredOutput('{"ok":"yes"}', schema),
		),
		/ok: expected boolean/,
	);
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
