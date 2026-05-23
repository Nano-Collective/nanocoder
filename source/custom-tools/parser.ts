import {readFileSync} from 'node:fs';
import {
	parseSubscribeBlock,
	SubscribeParseError,
} from '@/skills/parse-subscribe';
import type {
	CustomToolApprovalPolicy,
	CustomToolMetadata,
	CustomToolParameterDef,
	CustomToolParameterType,
	CustomToolShell,
} from '@/types/custom-tools';
import type {SkillTrigger} from '@/types/skills';
import {parseYamlObject, splitFrontmatter} from '@/utils/frontmatter';

const TOOL_NAME_REGEX = /^[a-z][a-z0-9_]*$/;
const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_TIMEOUT_MS = 300_000;

const VALID_PARAM_TYPES: ReadonlySet<CustomToolParameterType> = new Set([
	'string',
	'number',
	'integer',
	'boolean',
	'array',
]);

const VALID_APPROVAL: ReadonlySet<CustomToolApprovalPolicy> = new Set([
	'never',
	'always',
	'destructive',
]);

const VALID_SHELLS: ReadonlySet<CustomToolShell> = new Set(['bash', 'sh']);

export interface ParsedCustomToolFile {
	metadata: CustomToolMetadata;
	body: string;
	/**
	 * Event subscriptions declared in the file's frontmatter, if any. Target
	 * is implicit (the tool itself) and resolved by the skill registrar.
	 */
	subscribe?: SkillTrigger[];
}

export class CustomToolParseError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'CustomToolParseError';
	}
}

/**
 * Parse a custom tool markdown file into validated metadata and a script body.
 * Throws `CustomToolParseError` on any structural problem; the loader catches
 * these and logs them so a single bad file doesn't break the rest.
 */
export function parseCustomToolFile(filePath: string): ParsedCustomToolFile {
	const fileContent = readFileSync(filePath, 'utf-8');
	const split = splitFrontmatter(fileContent);
	if (!split.hasFrontmatter) {
		throw new CustomToolParseError(
			'Missing YAML frontmatter — custom tools must declare metadata between --- markers',
		);
	}

	const raw = parseYamlObject(split.frontmatter);
	if (raw === null) {
		throw new CustomToolParseError('Frontmatter is not a valid YAML object');
	}

	const metadata = validateMetadata(raw);
	if (!split.body.trim()) {
		throw new CustomToolParseError('Tool body (shell script) is empty');
	}

	let subscribe: SkillTrigger[] | undefined;
	try {
		subscribe = parseSubscribeBlock(raw.subscribe);
	} catch (err) {
		if (err instanceof SubscribeParseError) {
			throw new CustomToolParseError(err.message);
		}
		throw err;
	}

	return {metadata, body: split.body, subscribe};
}

function validateMetadata(raw: Record<string, unknown>): CustomToolMetadata {
	const name = raw.name;
	if (typeof name !== 'string' || !TOOL_NAME_REGEX.test(name)) {
		throw new CustomToolParseError(
			`Invalid or missing "name" — must match ${TOOL_NAME_REGEX} (snake_case starting with a letter)`,
		);
	}

	const description = raw.description;
	if (typeof description !== 'string' || !description.trim()) {
		throw new CustomToolParseError('Missing "description"');
	}

	const parameters = parseParameters(raw.parameters);
	const approval = parseApproval(raw.approval);
	const readOnly = parseReadOnly(raw.read_only, approval);
	const timeoutMs = parseTimeout(raw.timeout_ms);
	const cwd = raw.cwd === undefined ? undefined : asString(raw.cwd, 'cwd');
	const env = parseEnv(raw.env);
	const shell = parseShell(raw.shell);

	return {
		name,
		description: description.trim(),
		parameters,
		approval,
		readOnly,
		timeoutMs,
		cwd,
		env,
		shell,
	};
}

function parseParameters(
	value: unknown,
): Record<string, CustomToolParameterDef> {
	if (value === undefined || value === null) return {};

	// Canonical form: a mapping `{paramName: {type, ...}}`.
	// Also accept the list-of-objects form `[{name, type, ...}, ...]` that
	// JSON Schema / OpenAPI use, since AIs reliably produce that shape when
	// asked to scaffold a tool. The two forms are equivalent; we normalize
	// to the canonical mapping internally.
	const normalized = Array.isArray(value)
		? listToMapping(value)
		: (value as unknown);

	if (
		normalized === null ||
		typeof normalized !== 'object' ||
		Array.isArray(normalized)
	) {
		throw new CustomToolParseError(
			'"parameters" must be a mapping of name → definition (or a list of {name, type, ...} entries)',
		);
	}

	const result: Record<string, CustomToolParameterDef> = {};
	for (const [paramName, rawDef] of Object.entries(
		normalized as Record<string, unknown>,
	)) {
		if (!TOOL_NAME_REGEX.test(paramName)) {
			throw new CustomToolParseError(
				`Invalid parameter name "${paramName}" — must match ${TOOL_NAME_REGEX}`,
			);
		}
		if (!rawDef || typeof rawDef !== 'object' || Array.isArray(rawDef)) {
			throw new CustomToolParseError(
				`Parameter "${paramName}" must be a mapping with at least a "type" field`,
			);
		}
		result[paramName] = parseParameterDef(
			paramName,
			rawDef as Record<string, unknown>,
		);
	}
	return result;
}

/**
 * Convert the list-of-objects parameter form (each entry has a `name:`
 * field plus the rest of the definition) into the canonical mapping
 * `{paramName: {...}}`. Used to tolerate the OpenAPI / JSON Schema shape
 * that AI-generated tool stubs often produce.
 */
function listToMapping(list: unknown[]): Record<string, unknown> {
	const out: Record<string, unknown> = {};
	for (let i = 0; i < list.length; i++) {
		const entry = list[i];
		if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
			throw new CustomToolParseError(
				`parameters[${i}] must be a mapping with at least a "name" and "type"`,
			);
		}
		const obj = entry as Record<string, unknown>;
		const name = obj.name;
		if (typeof name !== 'string' || !name) {
			throw new CustomToolParseError(
				`parameters[${i}] is missing a "name" field`,
			);
		}
		const {name: _name, ...rest} = obj;
		out[name] = rest;
	}
	return out;
}

function parseParameterDef(
	paramName: string,
	raw: Record<string, unknown>,
): CustomToolParameterDef {
	const type = raw.type;
	if (
		typeof type !== 'string' ||
		!VALID_PARAM_TYPES.has(type as CustomToolParameterType)
	) {
		throw new CustomToolParseError(
			`Parameter "${paramName}" has invalid type "${String(type)}" — expected one of: ${Array.from(VALID_PARAM_TYPES).join(', ')}`,
		);
	}

	const def: CustomToolParameterDef = {type: type as CustomToolParameterType};
	if (raw.description !== undefined) {
		def.description = asString(
			raw.description,
			`parameters.${paramName}.description`,
		);
	}
	if (raw.required !== undefined) {
		if (typeof raw.required !== 'boolean') {
			throw new CustomToolParseError(
				`Parameter "${paramName}": required must be a boolean`,
			);
		}
		def.required = raw.required;
	}
	if (raw.default !== undefined) {
		def.default = raw.default;
	}
	if (raw.enum !== undefined) {
		if (!Array.isArray(raw.enum)) {
			throw new CustomToolParseError(
				`Parameter "${paramName}": enum must be an array`,
			);
		}
		def.enum = raw.enum;
	}
	if (raw.pattern !== undefined) {
		const pattern = asString(raw.pattern, `parameters.${paramName}.pattern`);
		try {
			new RegExp(pattern);
		} catch {
			throw new CustomToolParseError(
				`Parameter "${paramName}": pattern is not a valid regular expression`,
			);
		}
		def.pattern = pattern;
	}
	if (raw.minLength !== undefined) {
		def.minLength = asInteger(
			raw.minLength,
			`parameters.${paramName}.minLength`,
		);
	}
	if (raw.maxLength !== undefined) {
		def.maxLength = asInteger(
			raw.maxLength,
			`parameters.${paramName}.maxLength`,
		);
	}
	if (raw.min !== undefined) {
		def.min = asNumber(raw.min, `parameters.${paramName}.min`);
	}
	if (raw.max !== undefined) {
		def.max = asNumber(raw.max, `parameters.${paramName}.max`);
	}
	if (raw.items !== undefined) {
		if (
			!raw.items ||
			typeof raw.items !== 'object' ||
			Array.isArray(raw.items)
		) {
			throw new CustomToolParseError(
				`Parameter "${paramName}": items must be a mapping with a "type" field`,
			);
		}
		const itemType = (raw.items as Record<string, unknown>).type;
		if (
			typeof itemType !== 'string' ||
			!VALID_PARAM_TYPES.has(itemType as CustomToolParameterType)
		) {
			throw new CustomToolParseError(
				`Parameter "${paramName}": items.type is invalid`,
			);
		}
		def.items = {type: itemType as CustomToolParameterType};
	}
	return def;
}

function parseApproval(value: unknown): CustomToolApprovalPolicy {
	if (value === undefined || value === null) return 'always';
	if (
		typeof value !== 'string' ||
		!VALID_APPROVAL.has(value as CustomToolApprovalPolicy)
	) {
		throw new CustomToolParseError(
			`Invalid "approval" value — expected one of: ${Array.from(VALID_APPROVAL).join(', ')}`,
		);
	}
	return value as CustomToolApprovalPolicy;
}

function parseReadOnly(
	value: unknown,
	approval: CustomToolApprovalPolicy,
): boolean {
	if (value === undefined || value === null) {
		// Default: tools with approval=never are treated as read-only so they
		// can run in parallel. Anything that needs approval is assumed mutating
		// unless explicitly marked read_only: true.
		return approval === 'never';
	}
	if (typeof value !== 'boolean') {
		throw new CustomToolParseError('"read_only" must be a boolean');
	}
	return value;
}

function parseTimeout(value: unknown): number {
	if (value === undefined || value === null) return DEFAULT_TIMEOUT_MS;
	const n = asInteger(value, 'timeout_ms');
	if (n <= 0) {
		throw new CustomToolParseError('"timeout_ms" must be positive');
	}
	if (n > MAX_TIMEOUT_MS) {
		throw new CustomToolParseError(
			`"timeout_ms" exceeds maximum of ${MAX_TIMEOUT_MS}`,
		);
	}
	return n;
}

function parseEnv(value: unknown): Record<string, string> | undefined {
	if (value === undefined || value === null) return undefined;
	if (typeof value !== 'object' || Array.isArray(value)) {
		throw new CustomToolParseError('"env" must be a mapping of name → value');
	}
	const env: Record<string, string> = {};
	for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
		env[k] = v === null || v === undefined ? '' : String(v);
	}
	return env;
}

function parseShell(value: unknown): CustomToolShell | undefined {
	if (value === undefined || value === null) return undefined;
	if (
		typeof value !== 'string' ||
		!VALID_SHELLS.has(value as CustomToolShell)
	) {
		throw new CustomToolParseError(
			`Invalid "shell" — expected one of: ${Array.from(VALID_SHELLS).join(', ')}`,
		);
	}
	return value as CustomToolShell;
}

function asString(value: unknown, label: string): string {
	if (typeof value !== 'string') {
		throw new CustomToolParseError(`${label} must be a string`);
	}
	return value;
}

function asNumber(value: unknown, label: string): number {
	if (typeof value !== 'number' || !Number.isFinite(value)) {
		throw new CustomToolParseError(`${label} must be a finite number`);
	}
	return value;
}

function asInteger(value: unknown, label: string): number {
	const n = asNumber(value, label);
	if (!Number.isInteger(n)) {
		throw new CustomToolParseError(`${label} must be an integer`);
	}
	return n;
}
