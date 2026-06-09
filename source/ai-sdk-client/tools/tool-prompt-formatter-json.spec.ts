import test from 'ava';
import {jsonSchema, tool} from 'ai';
import {formatToolsForJSONPrompt} from './tool-prompt-formatter-json.js';

console.log('\ntool-prompt-formatter-json.spec.ts');

const createTestTool = (
	description: string,
	properties: Record<string, {type: string; description: string}>,
	required: string[],
) => {
	return tool({
		description,
		inputSchema: jsonSchema<Record<string, unknown>>({
			type: 'object',
			properties,
			required,
		}),
		execute: async () => 'test result',
	});
};

test('formatToolsForJSONPrompt returns empty string for empty tools', t => {
	const result = formatToolsForJSONPrompt({});
	t.is(result, '');
});

test('formatToolsForJSONPrompt formats a single tool with description and JSON schema', t => {
	const tools = {
		read_file: createTestTool(
			'Read a file from the filesystem',
			{
				path: {type: 'string', description: 'The path to the file'},
				encoding: {type: 'string', description: 'The file encoding'},
			},
			['path'],
		),
	};

	const result = formatToolsForJSONPrompt(tools);

	t.true(result.includes('## AVAILABLE TOOLS'));
	t.true(result.includes('JSON code block'));
	t.true(result.includes('### read_file'));
	t.true(result.includes('Read a file from the filesystem'));
	t.true(result.includes('**Input schema (JSON Schema):**'));
	// The literal JSON schema is embedded
	t.true(result.includes('"path"'));
	t.true(result.includes('"encoding"'));
	t.true(result.includes('"required"'));
});

test('formatToolsForJSONPrompt embeds a JSON example call shape', t => {
	const tools = {
		read_file: createTestTool(
			'Read a file',
			{path: {type: 'string', description: 'File path'}},
			['path'],
		),
	};

	const result = formatToolsForJSONPrompt(tools);

	t.true(result.includes('**Example:**'));
	t.true(result.includes('"name": "read_file"'));
	t.true(result.includes('"arguments"'));
});

test('formatToolsForJSONPrompt warns away from XML/function syntax', t => {
	const tools = {
		test_tool: createTestTool(
			'Test',
			{p: {type: 'string', description: 'p'}},
			['p'],
		),
	};

	const result = formatToolsForJSONPrompt(tools);

	t.true(result.includes('Do NOT use XML'));
});

test('formatToolsForJSONPrompt formats multiple tools', t => {
	const tools = {
		read_file: createTestTool(
			'Read a file',
			{path: {type: 'string', description: 'File path'}},
			['path'],
		),
		write_file: createTestTool(
			'Write a file',
			{
				path: {type: 'string', description: 'File path'},
				content: {type: 'string', description: 'File content'},
			},
			['path', 'content'],
		),
	};

	const result = formatToolsForJSONPrompt(tools);

	t.true(result.includes('### read_file'));
	t.true(result.includes('### write_file'));
});
