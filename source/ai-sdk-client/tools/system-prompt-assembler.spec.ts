import test from 'ava';
import {jsonSchema, tool} from 'ai';
import {appendToolDefinitionsToPrompt} from './system-prompt-assembler.js';

console.log('\nsystem-prompt-assembler.spec.ts');

const BASE_PROMPT = 'You are a helpful coding assistant.';

const createTestTool = (description: string) =>
	tool({
		description,
		inputSchema: jsonSchema<Record<string, unknown>>({
			type: 'object',
			properties: {
				path: {type: 'string', description: 'File path'},
			},
			required: ['path'],
		}),
		execute: async () => 'ok',
	});

const SAMPLE_TOOLS = {
	read_file: createTestTool('Read a file'),
};

// Native path: prompt unchanged regardless of fallback format choice

test('appendToolDefinitionsToPrompt: returns base prompt unchanged when toolsDisabled is false (xml format)', t => {
	const result = appendToolDefinitionsToPrompt(
		BASE_PROMPT,
		false,
		'xml',
		SAMPLE_TOOLS,
	);
	t.is(result, BASE_PROMPT);
	t.false(result.includes('## AVAILABLE TOOLS'));
});

test('appendToolDefinitionsToPrompt: returns base prompt unchanged when toolsDisabled is false (json format)', t => {
	const result = appendToolDefinitionsToPrompt(
		BASE_PROMPT,
		false,
		'json',
		SAMPLE_TOOLS,
	);
	t.is(result, BASE_PROMPT);
	t.false(result.includes('## AVAILABLE TOOLS'));
});

// XML fallback: prompt gets XML tool block

test('appendToolDefinitionsToPrompt: appends XML tool definitions when toolsDisabled and format=xml', t => {
	const result = appendToolDefinitionsToPrompt(
		BASE_PROMPT,
		true,
		'xml',
		SAMPLE_TOOLS,
	);
	t.true(result.startsWith(BASE_PROMPT));
	t.true(result.includes('## AVAILABLE TOOLS'));
	t.true(result.includes('XML block'));
	t.true(result.includes('<tool_name>'));
	t.true(result.includes('### read_file'));
	t.true(result.includes('Read a file'));
	// XML mode does NOT use JSON Schema embed
	t.false(result.includes('JSON code block'));
	t.false(result.includes('"name": "read_file"'));
});

// JSON fallback: prompt gets JSON tool block with literal schema

test('appendToolDefinitionsToPrompt: appends JSON tool definitions when toolsDisabled and format=json', t => {
	const result = appendToolDefinitionsToPrompt(
		BASE_PROMPT,
		true,
		'json',
		SAMPLE_TOOLS,
	);
	t.true(result.startsWith(BASE_PROMPT));
	t.true(result.includes('## AVAILABLE TOOLS'));
	t.true(result.includes('JSON code block'));
	t.true(result.includes('### read_file'));
	t.true(result.includes('Read a file'));
	// JSON mode embeds the literal schema and JSON example
	t.true(result.includes('**Input schema (JSON Schema):**'));
	t.true(result.includes('"name": "read_file"'));
	// JSON mode does NOT include XML format header
	t.false(result.includes('XML block'));
});

// Empty tools: nothing appended

test('appendToolDefinitionsToPrompt: returns base prompt unchanged when no tools are provided (xml)', t => {
	const result = appendToolDefinitionsToPrompt(BASE_PROMPT, true, 'xml', {});
	t.is(result, BASE_PROMPT);
});

test('appendToolDefinitionsToPrompt: returns base prompt unchanged when no tools are provided (json)', t => {
	const result = appendToolDefinitionsToPrompt(BASE_PROMPT, true, 'json', {});
	t.is(result, BASE_PROMPT);
});

// XML and JSON outputs are distinct, mutually exclusive

test('appendToolDefinitionsToPrompt: XML and JSON modes produce distinct output for the same tools', t => {
	const xmlResult = appendToolDefinitionsToPrompt(
		BASE_PROMPT,
		true,
		'xml',
		SAMPLE_TOOLS,
	);
	const jsonResult = appendToolDefinitionsToPrompt(
		BASE_PROMPT,
		true,
		'json',
		SAMPLE_TOOLS,
	);
	t.not(xmlResult, jsonResult);
	// XML-only signature
	t.true(xmlResult.includes('<tool_name>'));
	t.false(jsonResult.includes('<tool_name>'));
	// JSON-only signature
	t.true(jsonResult.includes('"name": "read_file"'));
	t.false(xmlResult.includes('"name": "read_file"'));
});
