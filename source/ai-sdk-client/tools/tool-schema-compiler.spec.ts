import test from 'ava';
import {jsonSchema} from '@/types/core.js';
import {compileToolsToJsonSchema} from './tool-schema-compiler.js';

test('compileToolsToJsonSchema returns undefined for empty tools', t => {
	const result = compileToolsToJsonSchema({});
	t.is(result, undefined);
});

test('compileToolsToJsonSchema returns undefined for undefined tools', t => {
	const result = compileToolsToJsonSchema(undefined);
	t.is(result, undefined);
});

test('compileToolsToJsonSchema creates schema for single tool', t => {
	const tools = {
		get_weather: {
			description: 'Get weather for a location',
			inputSchema: jsonSchema({
				type: 'object',
				properties: {
					location: {type: 'string', description: 'City name'},
					units: {type: 'string', enum: ['celsius', 'fahrenheit']},
				},
				required: ['location'],
			}),
		},
	};

	const schema = compileToolsToJsonSchema(tools);

	t.truthy(schema);
	t.is(schema!.type, 'object');
	t.deepEqual(schema!.properties, {
		name: {type: 'string', const: 'get_weather'},
		arguments: {
			type: 'object',
			properties: {
				location: {type: 'string', description: 'City name'},
				units: {type: 'string', enum: ['celsius', 'fahrenheit']},
			},
			required: ['location'],
		},
	});
	t.deepEqual(schema!.required, ['name', 'arguments']);
	t.is(schema!.additionalProperties, false);
});

test('compileToolsToJsonSchema creates oneOf schema for multiple tools', t => {
	const tools = {
		get_weather: {
			description: 'Get weather',
			inputSchema: jsonSchema({
				type: 'object',
				properties: {
					location: {type: 'string'},
				},
				required: ['location'],
			}),
		},
		search_web: {
			description: 'Search the web',
			inputSchema: jsonSchema({
				type: 'object',
				properties: {
					query: {type: 'string'},
				},
				required: ['query'],
			}),
		},
	};

	const schema = compileToolsToJsonSchema(tools);

	t.truthy(schema);
	t.truthy(schema!.oneOf);
	t.true(Array.isArray(schema!.oneOf));
	t.is((schema!.oneOf as Array<unknown>).length, 2);

	const schemas = schema!.oneOf as Array<Record<string, unknown>>;

	// Check first tool
	t.is(schemas[0].type, 'object');
	const props0 = schemas[0].properties as Record<string, unknown>;
	t.deepEqual(props0.name, {type: 'string', const: 'get_weather'});

	// Check second tool
	t.is(schemas[1].type, 'object');
	const props1 = schemas[1].properties as Record<string, unknown>;
	t.deepEqual(props1.name, {type: 'string', const: 'search_web'});
});

test('compileToolsToJsonSchema handles tool with no parameters', t => {
	const tools = {
		list_files: {
			description: 'List all files',
			inputSchema: jsonSchema({
				type: 'object',
				properties: {},
			}),
		},
	};

	const schema = compileToolsToJsonSchema(tools);

	t.truthy(schema);
	t.is(schema!.type, 'object');
	const props = schema!.properties as Record<string, unknown>;
	t.deepEqual(props.name, {type: 'string', const: 'list_files'});
	t.deepEqual(props.arguments, {type: 'object', properties: {}});
});

test('compileToolsToJsonSchema handles tool without inputSchema', t => {
	const tools = {
		simple_tool: {
			description: 'A simple tool',
		},
	};

	const schema = compileToolsToJsonSchema(tools);

	t.truthy(schema);
	const props = schema!.properties as Record<string, unknown>;
	t.deepEqual(props.arguments, {type: 'object', properties: {}});
});
