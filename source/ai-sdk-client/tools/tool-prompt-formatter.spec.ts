import test from 'ava';
import {jsonSchema, tool} from 'ai';
import {formatToolsForPrompt} from './tool-prompt-formatter.js';

// Create test tools using AI SDK's tool() function
const createTestTool = (
	name: string,
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

test('formatToolsForPrompt returns empty string for empty tools', t => {
	const result = formatToolsForPrompt({});
	t.is(result, '');
});

test('formatToolsForPrompt formats a single tool with description and parameters', t => {
	const tools = {
		read_file: createTestTool(
			'read_file',
			'Read a file from the filesystem',
			{
				path: {type: 'string', description: 'The path to the file'},
				encoding: {type: 'string', description: 'The file encoding'},
			},
			['path'],
		),
	};

	const result = formatToolsForPrompt(tools);

	// Check header
	t.true(result.includes('## AVAILABLE TOOLS'));
	t.true(result.includes('XML block'));

	// Check tool name
	t.true(result.includes('### read_file'));

	// Check description
	t.true(result.includes('Read a file from the filesystem'));

	// Check parameters
	t.true(result.includes('**Parameters:**'));
	t.true(result.includes('`path`'));
	t.true(result.includes('(required)'));
	t.true(result.includes('`encoding`'));
	t.true(result.includes('(optional)'));

	// Check example
	t.true(result.includes('**Example:**'));
	t.true(result.includes('<read_file>'));
	t.true(result.includes('<path>value</path>'));
	t.true(result.includes('</read_file>'));
});

test('formatToolsForPrompt formats multiple tools', t => {
	const tools = {
		read_file: createTestTool(
			'read_file',
			'Read a file',
			{path: {type: 'string', description: 'File path'}},
			['path'],
		),
		write_file: createTestTool(
			'write_file',
			'Write a file',
			{
				path: {type: 'string', description: 'File path'},
				content: {type: 'string', description: 'File content'},
			},
			['path', 'content'],
		),
	};

	const result = formatToolsForPrompt(tools);

	t.true(result.includes('### read_file'));
	t.true(result.includes('### write_file'));
	t.true(result.includes('Read a file'));
	t.true(result.includes('Write a file'));
});

test('formatToolsForPrompt includes XML format instructions', t => {
	const tools = {
		test_tool: createTestTool(
			'test_tool',
			'Test tool',
			{param: {type: 'string', description: 'A parameter'}},
			['param'],
		),
	};

	const result = formatToolsForPrompt(tools);

	// Check for format instructions
	t.true(result.includes('exact format'));
	t.true(result.includes('<tool_name>'));
	t.true(result.includes('<param1>value1</param1>'));
	t.true(result.includes('</tool_name>'));

	// Check for important notes about XML format
	t.true(result.includes('Do NOT use attributes'));
	t.true(result.includes('<function=name>'));
});

test('formatToolsForPrompt handles tools with no required parameters', t => {
	const tools = {
		list_files: createTestTool(
			'list_files',
			'List files in directory',
			{
				path: {type: 'string', description: 'Directory path'},
				recursive: {type: 'boolean', description: 'List recursively'},
			},
			[], // No required params
		),
	};

	const result = formatToolsForPrompt(tools);

	t.true(result.includes('### list_files'));
	t.true(result.includes('(optional)'));
	// Both should be optional
	t.true(result.includes('`path`'));
	t.true(result.includes('`recursive`'));
});

test('formatToolsForPrompt shows parameter types', t => {
	const tools = {
		test_tool: createTestTool(
			'test_tool',
			'Test various types',
			{
				str_param: {type: 'string', description: 'A string'},
				num_param: {type: 'number', description: 'A number'},
				bool_param: {type: 'boolean', description: 'A boolean'},
			},
			['str_param'],
		),
	};

	const result = formatToolsForPrompt(tools);

	t.true(result.includes('(string)'));
	t.true(result.includes('(number)'));
	t.true(result.includes('(boolean)'));
});
