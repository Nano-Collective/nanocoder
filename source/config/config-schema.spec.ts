import {readFileSync} from 'fs';
import {join} from 'path';
import test from 'ava';
import Ajv from 'ajv';

/*
 * Validates the committed schemas/agents.config.schema.json.
 *
 * The schema is the source-of-truth artefact generated from the DiskConfig
 * type. These tests assert both its structural integrity (that it stays in
 * sync with what the loader actually reads from agents.config.json) and that
 * a range of real configs validate as expected — catching the cases where a
 * hand-tuned schema, or one generated with the wrong flags, silently rejects
 * valid config or accepts keys the loader ignores.
 */

const schemaPath = join(process.cwd(), 'schemas/agents.config.schema.json');
const schema = JSON.parse(readFileSync(schemaPath, 'utf-8'));

const ajv = new Ajv({strict: false, allErrors: true});
const validate = ajv.compile(schema);

function assertValid(t: test.ExecutionContext, label: string, config: unknown) {
	const ok = validate(config);
	t.true(ok, `${label} should be valid. Errors: ${JSON.stringify(validate.errors)}`);
	t.deepEqual(validate.errors, null);
}

function assertInvalid(
	t: test.ExecutionContext,
	label: string,
	config: unknown,
) {
	const ok = validate(config);
	t.false(ok, `${label} should be invalid. Errors: ${JSON.stringify(validate.errors)}`);
}

// ---------------------------------------------------------------------------
// Root structure
// ---------------------------------------------------------------------------

test('empty config file is valid', t => {
	assertValid(t, 'empty object', {});
});

test('config with only $schema is valid', t => {
	assertValid(t, '$schema only', {
		$schema: 'https://raw.githubusercontent.com/Nano-Collective/nanocoder/main/schemas/agents.config.schema.json',
	});
});

test('empty nanocoder namespace is valid', t => {
	assertValid(t, 'nanocoder empty', {nanocoder: {}});
});

test('unknown root-level keys are rejected', t => {
	assertInvalid(t, 'bogus root key', {bogus: 1});
});

test('unknown top-level $schema type is rejected', t => {
	assertInvalid(t, 'numeric $schema', {nanocoder: {}, $schema: 42});
});

// ---------------------------------------------------------------------------
// DiskNanocoderConfig — key coverage and strictness
// ---------------------------------------------------------------------------

test('unknown key inside nanocoder namespace is rejected', t => {
	assertInvalid(t, 'bogus namespace key', {nanocoder: {bogus: 1}});
});

test('unknown key deep inside a sub-object is rejected (headless)', t => {
	assertInvalid(t, 'headless bogus', {
		nanocoder: {headless: {bogus: 1}},
	});
});

test('all documented nanocoder fields are accepted together', t => {
	assertValid(t, 'full valid config', {
		nanocoder: {
			defaultMode: 'plan',
			autoCompact: {threshold: 70},
			providers: [
				{
					name: 'OpenRouter',
					models: ['anthropic/claude-4.5-sonnet'],
					headers: {Authorization: 'Bearer ${TOKEN}'},
				},
			],
			mcpServers: [{name: 'mcp', transport: 'stdio'}],
			alwaysAllow: ['execute_bash'],
			disabledTools: ['web_search'],
			systemPrompt: {mode: 'append', content: 'Be terse.'},
			tune: {toolProfile: 'minimal', toolMode: 'xml'},
			modeProviders: {plan: {provider: 'OpenRouter', model: 'gpt-4o'}},
			nanocoderTools: {webSearch: {apiKey: 'sk-abc'}},
			headless: {maxTurns: 20},
		},
	});
});

// ---------------------------------------------------------------------------
// defaultMode
// ---------------------------------------------------------------------------

test('defaultMode accepts every valid mode', t => {
	for (const mode of ['normal', 'auto-accept', 'yolo', 'plan']) {
		assertValid(t, `defaultMode ${mode}`, {nanocoder: {defaultMode: mode}});
	}
});

test('defaultMode rejects an invalid mode', t => {
	assertInvalid(t, 'defaultMode smurf', {nanocoder: {defaultMode: 'smurf'}});
});

// ---------------------------------------------------------------------------
// autoCompact — the loader defaults each field, so none should be required
// ---------------------------------------------------------------------------

test('autoCompact partial object is valid', t => {
	assertValid(t, 'autoCompact {threshold only}', {
		nanocoder: {autoCompact: {threshold: 70}},
	});
	assertValid(t, 'autoCompact {enabled only}', {
		nanocoder: {autoCompact: {enabled: true}},
	});
});

test('autoCompact rejects unknown key', t => {
	assertInvalid(t, 'autoCompact bogus', {
		nanocoder: {autoCompact: {bogus: true}},
	});
});

// ---------------------------------------------------------------------------
// providers (ProviderConfig)
// ---------------------------------------------------------------------------

test('provider requires name and models', t => {
	assertInvalid(t, 'provider missing name', {
		nanocoder: {providers: [{models: ['a']}]},
	});
	assertInvalid(t, 'provider missing models', {
		nanocoder: {providers: [{name: 'OpenRouter'}]},
	});
	assertValid(t, 'provider minimal', {
		nanocoder: {providers: [{name: 'OpenRouter', models: ['a']}]},
	});
});

test('provider accepts type-specific extra keys (index signature)', t => {
	// ProviderConfig has [key: string]: unknown, so arbitrary keys are legal.
	assertValid(t, 'provider custom key', {
		nanocoder: {
			providers: [{name: 'x', models: ['a'], customProviderKey: 42}],
		},
	});
});

test('provider accepts headers/timeout/orgId used by the loader', t => {
	assertValid(t, 'provider loader-supported fields', {
		nanocoder: {
			providers: [
				{
					name: 'x',
					models: ['a'],
					headers: {Authorization: 'Bearer ${KEY}'},
					timeout: 60000,
					organizationId: 'org-1',
					baseUrl: 'https://api.example.com/v1',
					apiKey: '${API_KEY}',
				},
			],
		},
	});
});

test('provider contextWindows must map to numbers', t => {
	assertInvalid(t, 'contextWindows bad value', {
		nanocoder: {
			providers: [{name: 'x', models: ['a'], contextWindows: {gpt: 'big'}}],
		},
	});
});

// ---------------------------------------------------------------------------
// OpenRouter / RecordStringUnknown
// ---------------------------------------------------------------------------

test('RecordStringUnknown (extraBody) accepts arbitrary keys', t => {
	// OpenRouterParameters.extraBody is Record<string, unknown>: any key/value.
	assertValid(t, 'extraBody with content', {
		nanocoder: {
			providers: [
				{
					name: 'openrouter',
					models: ['a'],
					openrouter: {extraBody: {custom_field: 'value', nested: {ok: true}}},
				},
			],
		},
	});
});

test('OpenRouterPlugin requires id', t => {
	assertInvalid(t, 'plugin missing id', {
		nanocoder: {
			providers: [
				{
					name: 'openrouter',
					models: ['a'],
					openrouter: {plugins: [{engine: 'middle-out'}]},
				},
			],
		},
	});
	assertValid(t, 'plugin with id', {
		nanocoder: {
			providers: [
				{
					name: 'openrouter',
					models: ['a'],
					openrouter: {plugins: [{id: 'context-compression', engine: 'middle-out'}]},
				},
			],
		},
	});
});

// ---------------------------------------------------------------------------
// lspServers
// ---------------------------------------------------------------------------

test('lspServers requires name, command, languages', t => {
	assertInvalid(t, 'lsp missing name', {
		nanocoder: {lspServers: [{command: 'c', languages: ['ts']}]},
	});
	assertInvalid(t, 'lsp missing command', {
		nanocoder: {lspServers: [{name: 'n', languages: ['ts']}]},
	});
	assertInvalid(t, 'lsp missing languages', {
		nanocoder: {lspServers: [{name: 'n', command: 'c'}]},
	});
	assertValid(t, 'lsp complete', {
		nanocoder: {lspServers: [{name: 'n', command: 'c', languages: ['ts']}]},
	});
});

// ---------------------------------------------------------------------------
// mcpServers (MCPServerConfig)
// ---------------------------------------------------------------------------

test('mcpServer requires name and transport', t => {
	assertInvalid(t, 'mcp missing transport', {
		nanocoder: {mcpServers: [{name: 'm'}]},
	});
	assertValid(t, 'mcp minimal', {
		nanocoder: {mcpServers: [{name: 'm', transport: 'stdio'}]},
	});
});

test('mcpServer transport enum is enforced', t => {
	assertInvalid(t, 'mcp bad transport', {
		nanocoder: {mcpServers: [{name: 'm', transport: 'grpc'}]},
	});
});

// ---------------------------------------------------------------------------
// modeProviders
// ---------------------------------------------------------------------------

test('modeProviders accepts valid provider/model objects', t => {
	assertValid(t, 'modeProviders', {
		nanocoder: {modeProviders: {plan: {provider: 'x', model: 'y'}}},
	});
});

test('modeProviders value requires provider and model', t => {
	assertInvalid(t, 'modeProvider missing provider', {
		nanocoder: {modeProviders: {plan: {model: 'y'}}},
	});
});

test('modeProviders value rejects extra keys', t => {
	assertInvalid(t, 'modeProviders value has extra key', {
		nanocoder: {
			modeProviders: {plan: {provider: 'x', model: 'y', temperature: 0.7}},
		},
	});
});

test('modeProviders rejects unknown mode keys', t => {
	assertInvalid(t, 'modeProviders headless mode key', {
		nanocoder: {modeProviders: {headless: {provider: 'x', model: 'y'}}},
	});
	assertInvalid(t, 'modeProviders typo mode key', {
		nanocoder: {modeProviders: {plann: {provider: 'x', model: 'y'}}},
	});
});

test('modeProviders accepts all valid mode keys together', t => {
	assertValid(t, 'modeProviders all modes', {
		nanocoder: {
			modeProviders: {
				normal: {provider: 'a', model: 'b'},
				'auto-accept': {provider: 'a', model: 'b'},
				yolo: {provider: 'a', model: 'b'},
				plan: {provider: 'a', model: 'b'},
			},
		},
	});
});

// ---------------------------------------------------------------------------
// retries (RetryLimitsConfig)
// ---------------------------------------------------------------------------

test('retries partial object is valid (per-field defaults)', t => {
	assertValid(t, 'retries maxRepeatedToolCalls only', {
		nanocoder: {retries: {maxRepeatedToolCalls: 5}},
	});
	assertValid(t, 'retries full', {
		nanocoder: {
			retries: {
				maxRepeatedToolCalls: 3,
				maxEmptyTurns: 2,
				maxMalformedRetries: 2,
			},
		},
	});
});

test('empty retries object is valid (all loader defaults)', t => {
	assertValid(t, 'retries empty', {nanocoder: {retries: {}}});
});

test('retries rejects unknown key', t => {
	assertInvalid(t, 'retries bogus', {
		nanocoder: {retries: {bogus: 1}},
	});
});

test('RetryLimitsConfig requires no fields and exposes all three retry caps', t => {
	const def = schema.definitions.RetryLimitsConfig;
	t.deepEqual(def.required, undefined);
	t.false(Object.values(def.properties).some((p: {required?: string[]}) => p.required));
	t.deepEqual(Object.keys(def.properties).sort(), [
		'maxEmptyTurns',
		'maxMalformedRetries',
		'maxRepeatedToolCalls',
	]);
});

// ---------------------------------------------------------------------------
// root-level providers (legacy form read by loadProjectProviderConfigs)
// ---------------------------------------------------------------------------

test('legacy root-level providers form is valid', t => {
	assertValid(t, 'root providers', {
		providers: [{name: 'OpenRouter', models: ['anthropic/claude-4.5-sonnet']}],
	});
});

test('legacy root-level provider requires name and models', t => {
	assertInvalid(t, 'root provider missing models', {
		providers: [{name: 'OpenRouter'}],
	});
	assertInvalid(t, 'root provider missing name', {
		providers: [{models: ['a']}],
	});
});

test('root-level and nanocoder providers may be combined', t => {
	assertValid(t, 'both provider forms', {
		providers: [{name: 'Root', models: ['a']}],
		nanocoder: {providers: [{name: 'Nested', models: ['b']}]},
	});
});

// ---------------------------------------------------------------------------
// structural integrity against the type
// ---------------------------------------------------------------------------

test('root wraps under nanocoder and declares $schema', t => {
	t.is(schema.type, 'object');
	t.deepEqual(
		Object.keys(schema.properties).sort(),
		['$schema', 'nanocoder', 'providers'].sort(),
	);
	t.is(schema.properties.nanocoder.$ref, '#/definitions/DiskNanocoderConfig');
	t.is(schema.additionalProperties, false);
});

test('DiskNanocoderConfig exposes every on-disk key', t => {
	const props = Object.keys(schema.definitions.DiskNanocoderConfig.properties);
	const expected = [
		'providers',
		'defaultMode',
		'autoCompact',
		'tune',
		'headless',
		'mcpServers',
		'lspServers',
		'alwaysAllow',
		'disabledTools',
		'systemPrompt',
		'nanocoderTools',
		'modeProviders',
		'retries',
	];
	for (const key of expected) {
		t.true(
			props.includes(key),
			`DiskNanocoderConfig should expose "${key}" (added to the on-disk type but missing from the schema?)`,
		);
	}
	// Preferences-only keys must NOT be advertised on the agents.config.json schema.
	for (const absent of ['notifications', 'sessions', 'paste']) {
		t.false(
			props.includes(absent),
			`"${absent}" lives in nanocoder-preferences.json and should not appear in the agents.config.json schema`,
		);
	}
	t.is(schema.definitions.DiskNanocoderConfig.additionalProperties, false);
});

test('definition names are clean (no TypeScript generics)', t => {
	for (const name of Object.keys(schema.definitions)) {
		for (const pattern of ['<', '>', '%3C', '%3E']) {
			t.false(
				name.includes(pattern),
				`Definition "${name}" contains "${pattern}"`,
			);
		}
	}
});

test('ProviderConfig requires name and models in the schema', t => {
	const def = schema.definitions.ProviderConfig;
	t.deepEqual([...(def.required ?? [])].sort(), ['models', 'name']);
});

test('MCPServerConfig requires name and transport in the schema', t => {
	const def = schema.definitions.MCPServerConfig;
	t.deepEqual([...(def.required ?? [])].sort(), ['name', 'transport']);
});

test('RecordStringString maps to additionalProperties of type string', t => {
	const def = schema.definitions.RecordStringString;
	t.deepEqual(def.additionalProperties, {type: 'string'});
});
