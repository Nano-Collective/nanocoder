import test from 'ava';
import type {AIProviderConfig} from '@/types/config.js';
import {jsonSchema} from '@/types/core.js';
import {buildProviderOptions} from './provider-options.js';

// Helper to create a minimal provider config
function createProviderConfig(
	name: string,
	overrides?: Partial<AIProviderConfig>,
): AIProviderConfig {
	return {
		name,
		type: 'openai-compatible',
		models: ['test-model'],
		config: {},
		...overrides,
	};
}

test('buildProviderOptions returns undefined when no provider-specific options', t => {
	const config = createProviderConfig('generic-provider');
	const result = buildProviderOptions(config, '', undefined);
	t.is(result, undefined);
});

test('buildProviderOptions handles chatgpt-codex provider', t => {
	const config = createProviderConfig('codex', {sdkProvider: 'chatgpt-codex'});
	const result = buildProviderOptions(config, 'Test system prompt', {
		reasoningEffort: 'high',
	});

	t.truthy(result);
	t.truthy(result!.openai);
	t.is(result!.openai.instructions, 'Test system prompt');
	t.is(result!.openai.store, false);
	t.is(result!.openai.reasoningEffort, 'high');
});

test('buildProviderOptions handles OpenRouter provider', t => {
	const config = createProviderConfig('openrouter', {
		openrouter: {
			service_tier: 'flex',
			models: ['model-fallback-1', 'model-fallback-2'],
		},
	});
	const result = buildProviderOptions(config, '', undefined);

	t.truthy(result);
	t.truthy(result!.openrouter);
	t.is(result!.openrouter.service_tier, 'flex');
	t.deepEqual(result!.openrouter.models, [
		'model-fallback-1',
		'model-fallback-2',
	]);
});

test('buildProviderOptions: constrained generation disabled without flag', t => {
	const config = createProviderConfig('ollama', {
		constrainedGeneration: {
			enableConstrainedGeneration: false,
		},
	});
	const tools = {
		test_tool: {
			description: 'Test',
			inputSchema: jsonSchema({
				type: 'object',
				properties: {param: {type: 'string'}},
			}),
		},
	};
	const result = buildProviderOptions(config, '', undefined, tools);
	t.is(result, undefined);
});

test('buildProviderOptions: constrained generation disabled without tools', t => {
	const config = createProviderConfig('ollama', {
		constrainedGeneration: {
			enableConstrainedGeneration: true,
		},
	});
	const result = buildProviderOptions(config, '', undefined, {});
	t.is(result, undefined);
});

test('buildProviderOptions: Ollama provider adds format json', t => {
	const config = createProviderConfig('ollama', {
		constrainedGeneration: {
			enableConstrainedGeneration: true,
		},
	});
	const tools = {
		get_weather: {
			description: 'Get weather',
			inputSchema: jsonSchema({
				type: 'object',
				properties: {location: {type: 'string'}},
			}),
		},
	};
	const result = buildProviderOptions(config, '', undefined, tools);

	t.truthy(result);
	t.truthy(result!.ollama);
	t.is(result!.ollama.format, 'json');
});

test('buildProviderOptions: vLLM provider adds guided_json', t => {
	const config = createProviderConfig('vllm', {
		constrainedGeneration: {
			enableConstrainedGeneration: true,
		},
	});
	const tools = {
		search: {
			description: 'Search',
			inputSchema: jsonSchema({
				type: 'object',
				properties: {query: {type: 'string'}},
				required: ['query'],
			}),
		},
	};
	const result = buildProviderOptions(config, '', undefined, tools);

	t.truthy(result);
	t.truthy(result!.vllm);
	t.truthy(result!.vllm.guided_json);
	const schema = result!.vllm.guided_json as Record<string, unknown>;
	t.is(schema.type, 'object');
	const props = schema.properties as Record<string, unknown>;
	t.truthy(props.name);
	t.truthy(props.arguments);
});

test('buildProviderOptions: llama.cpp provider adds json_schema', t => {
	const config = createProviderConfig('llama.cpp', {
		constrainedGeneration: {
			enableConstrainedGeneration: true,
		},
	});
	const tools = {
		calculate: {
			description: 'Calculate',
			inputSchema: jsonSchema({
				type: 'object',
				properties: {
					a: {type: 'number'},
					b: {type: 'number'},
				},
				required: ['a', 'b'],
			}),
		},
	};
	const result = buildProviderOptions(config, '', undefined, tools);

	t.truthy(result);
	t.truthy(result!['llama.cpp']);
	t.truthy(result!['llama.cpp'].json_schema);
});

test('buildProviderOptions: llama-cpp variant (hyphen) works', t => {
	const config = createProviderConfig('llama-cpp', {
		constrainedGeneration: {
			enableConstrainedGeneration: true,
		},
	});
	const tools = {
		test: {inputSchema: jsonSchema({type: 'object', properties: {}})},
	};
	const result = buildProviderOptions(config, '', undefined, tools);

	t.truthy(result);
	t.truthy(result!['llama-cpp']);
});

test('buildProviderOptions: generic provider adds response_format', t => {
	const config = createProviderConfig('custom-provider', {
		constrainedGeneration: {
			enableConstrainedGeneration: true,
		},
	});
	const tools = {
		action: {
			description: 'Perform action',
			inputSchema: jsonSchema({
				type: 'object',
				properties: {type: {type: 'string', enum: ['A', 'B']}},
			}),
		},
	};
	const result = buildProviderOptions(config, '', undefined, tools);

	t.truthy(result);
	t.truthy(result!['custom-provider']);
	t.truthy(result!['custom-provider'].response_format);
	const format = result!['custom-provider'].response_format as Record<
		string,
		unknown
	>;
	t.is(format.type, 'json_schema');
	t.truthy(format.json_schema);
});

test('buildProviderOptions: extraBody merges with constrained generation', t => {
	const config = createProviderConfig('vllm', {
		constrainedGeneration: {
			enableConstrainedGeneration: true,
			extraBody: {
				custom_param: 'custom_value',
				temperature: 0.7,
			},
		},
	});
	const tools = {
		test: {inputSchema: jsonSchema({type: 'object', properties: {}})},
	};
	const result = buildProviderOptions(config, '', undefined, tools);

	t.truthy(result);
	t.truthy(result!.vllm);
	t.is(result!.vllm.custom_param, 'custom_value');
	t.is(result!.vllm.temperature, 0.7);
	t.truthy(result!.vllm.guided_json);
});

test('buildProviderOptions: extraBody does not override constrained fields', t => {
	const config = createProviderConfig('ollama', {
		constrainedGeneration: {
			enableConstrainedGeneration: true,
			extraBody: {
				format: 'text', // Should be overridden
			},
		},
	});
	const tools = {
		test: {inputSchema: jsonSchema({type: 'object', properties: {}})},
	};
	const result = buildProviderOptions(config, '', undefined, tools);

	t.truthy(result);
	// extraBody is spread first, then format: 'json' is set, so json wins
	t.is(result!.ollama.format, 'json');
});

test('buildProviderOptions: multiple tools create oneOf schema', t => {
	const config = createProviderConfig('vllm', {
		constrainedGeneration: {
			enableConstrainedGeneration: true,
		},
	});
	const tools = {
		tool1: {inputSchema: jsonSchema({type: 'object', properties: {}})},
		tool2: {inputSchema: jsonSchema({type: 'object', properties: {}})},
	};
	const result = buildProviderOptions(config, '', undefined, tools);

	t.truthy(result);
	const schema = result!.vllm.guided_json as Record<string, unknown>;
	t.truthy(schema.oneOf);
	t.true(Array.isArray(schema.oneOf));
	t.is((schema.oneOf as Array<unknown>).length, 2);
});
