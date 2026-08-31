/**
 * Generates a JSON Schema for agents.config.json from the DiskConfig
 * TypeScript definition. Run: pnpm run generate:schema
 * Output: schemas/agents.config.schema.json
 *
 * Design notes:
 *   - Generated from `DiskConfig`, the on-disk shape of agents.config.json.
 *     This differs from the runtime `AppConfig`: it includes `$schema` and
 *     `defaultMode` (read outside AppConfig by the loader) and excludes
 *     `notifications`/`sessions`/`paste` (which live in
 *     nanocoder-preferences.json and are ignored when present here).
 *   - `--required` is NOT used, so loader-defaulted sub-objects
 *     (autoCompact, tune, headless) stay all-optional. Genuinely required
 *     fields are added by hand (ProviderConfig.name/models,
 *     MCPServerConfig.name/transport).
 *   - `--noExtraProps` is NOT used: it corrupts `Record<string, X>` into
 *     `{type:object, additionalProperties:false}` which rejects every key.
 *     Instead `additionalProperties: false` is applied eagerly to every
 *     `type: object` node that lacks one (index-signature types keep their
 *     permissive `additionalProperties: {}`), and `Record` types are rewritten
 *     to their proper `additionalProperties: {type}` form.
 *   - Passing `tsconfig.json` as the first argument makes typescript-json-schema
 *     resolve the `@/*` path aliases and bundler module settings exactly like
 *     tsc does, so nested types (ModeProviders, AutoCompactConfig, TuneConfig)
 *     keep their real structure and get real editor autocomplete.
 *
 * The committed schema is the artefact. Regenerating must be byte-identical —
 * a CI drift check enforces that.
 */

import {execSync} from 'child_process';
import {mkdirSync, writeFileSync} from 'fs';
import {dirname, join} from 'path';
import {fileURLToPath} from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = join(__dirname, '..');

const outputFile = join(projectRoot, 'schemas', 'agents.config.schema.json');

// ---------------------------------------------------------------------------
// 1. Generate the base schema from DiskConfig via the CLI with tsconfig.json
// ---------------------------------------------------------------------------
let rawText: string;
try {
	rawText = execSync(`npx typescript-json-schema tsconfig.json DiskConfig`, {
		encoding: 'utf-8',
		cwd: projectRoot,
		stdio: ['pipe', 'pipe', 'pipe'],
	});
} catch (error: unknown) {
	const err = error as {stdout?: string; message?: string};
	// The CLI prints the schema to stdout even on a non-zero exit when there
	// are type errors it can paper over. If stdout is empty treat it as fatal.
	rawText = err.stdout ?? '';
	if (!rawText.trim()) {
		process.stderr.write(`${String(error)}\n`);
		process.stderr.write('Schema generation failed — no output produced\n');
		process.exit(1);
	}
}

let raw: Record<string, unknown>;
try {
	raw = JSON.parse(rawText) as Record<string, unknown>;
} catch (error: unknown) {
	process.stderr.write(`Failed to parse generator output: ${String(error)}\n`);
	process.stderr.write(rawText.slice(0, 2000) + '\n');
	process.exit(1);
}

// ---------------------------------------------------------------------------
// 2. Rename ugly TypeScript-generic definition names
// ---------------------------------------------------------------------------
const definitionRenames: Record<string, string> = {
	'Partial<AutoCompactConfig>': 'AutoCompactConfig',
	'Partial<TuneConfig>': 'TuneConfig',
	'Record<string,ModeProviderConfig>': 'ModeProviders',
	'Record<string,number>': 'RecordStringNumber',
	'Record<string,string>': 'RecordStringString',
	'Record<string,unknown>': 'RecordStringUnknown',
};

type JsonNode = Record<string, unknown>;

// Recursively rewrite $ref pointers to the cleaned names.
function rewriteRefs(node: unknown): unknown {
	if (Array.isArray(node)) {
		return node.map(rewriteRefs);
	}
	if (!node || typeof node !== 'object') return node;

	const obj = node as JsonNode;
	const ref = obj['$ref'];
	if (typeof ref === 'string' && ref.startsWith('#/definitions/')) {
		const match = /^#\/definitions\/(.+)$/.exec(ref);
		if (match) {
			const rawName = decodeURIComponent(match[1]);
			const newName = definitionRenames[rawName] ?? rawName;
			if (newName !== rawName) {
				obj['$ref'] = `#/definitions/${newName}`;
			}
		}
	}

	for (const key of Object.keys(obj)) {
		obj[key] = rewriteRefs(obj[key]);
	}
	return obj;
}

// Re-key the definitions map, dropping renamed originals.
function renameDefinitions(definitions: Record<string, unknown>): void {
	const renamed: Record<string, unknown> = {};
	for (const [name, def] of Object.entries(definitions)) {
		const newName = definitionRenames[name] ?? name;
		renamed[newName] = rewriteRefs(def);
	}
	for (const oldName of Object.keys(definitionRenames)) {
		delete renamed[oldName];
	}
	// Mutate in place so the caller's reference stays valid.
	for (const key of Object.keys(definitions)) delete definitions[key];
	Object.assign(definitions, renamed);
}

// Record<string, X> => { type: object, additionalProperties: { type: X } }.
function expandRecords(definitions: Record<string, unknown>): void {
	const records: Record<string, string> = {
		RecordStringString: 'string',
		RecordStringNumber: 'number',
	};

	// Record<string, ModeProviderConfig> — expand to an object whose values
	// are the ModeProviderConfig schema. Inline the ref'd value schema so
	// editors get autocomplete for the nested provider/model fields.
	const modeProvidersDef = definitions['ModeProviders'] as JsonNode | undefined;
	if (modeProvidersDef && modeProvidersDef.type === 'object') {
		definitions['ModeProviders'] = {
			type: 'object',
			additionalProperties: {
				type: 'object',
				properties: {
					model: {type: 'string'},
					provider: {type: 'string'},
				},
				required: ['model', 'provider'],
				additionalProperties: false,
			},
		};
	}

	for (const [name, valueType] of Object.entries(records)) {
		if (!definitions[name]) continue;
		definitions[name] = {
			type: 'object',
			additionalProperties: {type: valueType},
		};
	}
}

// Set the genuinely required fields on strict types.
function setRequired(
	definitions: Record<string, unknown>,
	name: string,
	fields: string[],
): void {
	const def = definitions[name] as JsonNode | undefined;
	if (def) {
		const existing = (def.required as string[] | undefined) ?? [];
		def.required = [...new Set([...existing, ...fields])];
	}
}

// Apply strictness (additionalProperties: false) to every `type: object`
// schema node that does not already carry an `additionalProperties` key.
// Objects with `[key: string]: unknown` index signatures already have
// additionalProperties: {} emitted by the generator, and Record types have
// additionalProperties: {type}, so both are skipped automatically. This
// reaches anonymous inline objects (headless, lspServers items, provider
// connectionPool, nanocoderTools) that the generator lists without a
// strictness keyword.
function applyStrictness(node: unknown): void {
	if (Array.isArray(node)) {
		for (const item of node) applyStrictness(item);
		return;
	}
	if (!node || typeof node !== 'object') return;

	const obj = node as JsonNode;
	if (obj.type === 'object' && obj.additionalProperties === undefined) {
		obj.additionalProperties = false;
	}

	for (const key of Object.keys(obj)) {
		applyStrictness(obj[key]);
	}
}

// ---------------------------------------------------------------------------
// 3. Assemble the final schema
// ---------------------------------------------------------------------------
function main(): void {
	const definitions = (raw['definitions'] ?? {}) as Record<string, unknown>;

	renameDefinitions(definitions);
	expandRecords(definitions);
	applyStrictness(definitions);
	applyStrictness(raw.properties);
	setRequired(definitions, 'ProviderConfig', ['name', 'models']);
	setRequired(definitions, 'MCPServerConfig', ['name', 'transport']);

	const finalSchema: JsonNode = {
		$schema: 'http://json-schema.org/draft-07/schema#',
		$id: 'https://raw.githubusercontent.com/Nano-Collective/nanocoder/main/schemas/agents.config.schema.json',
		type: 'object',
		properties: (raw.properties ?? {}) as JsonNode,
		definitions,
		additionalProperties: false,
	};

	mkdirSync(dirname(outputFile), {recursive: true});
	writeFileSync(outputFile, JSON.stringify(finalSchema, null, '\t') + '\n');

	// Format with Biome to match project style (compact enum arrays).
	execSync(`pnpm exec biome check --write "${outputFile}"`, {cwd: projectRoot});

	process.stderr.write(`Schema written to ${outputFile}\n`);
	process.stderr.write(`Definitions: ${Object.keys(definitions).length}\n`);
}

main();
