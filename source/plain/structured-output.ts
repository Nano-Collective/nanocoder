import {readFileSync} from 'node:fs';
import type {ErrorObject, ValidateFunction} from 'ajv';
import type {JsonSchemaDocument} from '@/tools/runtime/schema-validate';
import type {ValidationErrorDetail} from '@/types/core';

/**
 * `nanocoder run --json-schema` support.
 *
 * The flag value is either a path to a schema file or inline JSON. Once the
 * model produces a content-only final answer, the answer is parsed as one JSON
 * document and checked against the schema. Invalid answers are fed back with
 * their errors so the model can correct itself; the retry cap is the existing
 * `nanocoder.retries.maxMalformedRetries` budget.
 */

export interface StructuredOutputValidation {
	ok: boolean;
	value?: unknown;
	errors: ValidationErrorDetail[];
	/** Set when the answer was not a single JSON document at all. */
	parseError?: string;
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

type AjvInstance = import('ajv').default;
const ajvInstances = new Map<string, Promise<AjvInstance>>();
const compiledSchemas = new WeakMap<JsonSchemaDocument, ValidateFunction>();

// Ajv ships no `format` validators without an extra package, and strict mode
// refuses a schema that names one (`date-time`, `uri`, `email`). Formats are
// annotations here, so they are accepted and not enforced.
const AJV_OPTIONS = {multipleOfPrecision: 12, validateFormats: false};

function ajvFor(schema: JsonSchemaDocument): Promise<AjvInstance> {
	const dialect = String(schema.$schema ?? '');
	const key = dialect.includes('2020-12')
		? '2020'
		: dialect.includes('2019-09')
			? '2019'
			: 'draft7';
	let instance = ajvInstances.get(key);
	if (!instance) {
		instance = (
			key === '2020'
				? import('ajv/dist/2020.js').then(m => new m.default(AJV_OPTIONS))
				: key === '2019'
					? import('ajv/dist/2019.js').then(m => new m.default(AJV_OPTIONS))
					: import('ajv').then(m => new m.default(AJV_OPTIONS))
		) as Promise<AjvInstance>;
		ajvInstances.set(key, instance);
	}
	return instance;
}

async function compileSchema(
	schema: JsonSchemaDocument,
): Promise<ValidateFunction> {
	const cached = compiledSchemas.get(schema);
	if (cached) return cached;

	const ajv = await ajvFor(schema);
	const validate = ajv.compile(schema);
	compiledSchemas.set(schema, validate);
	return validate;
}

function pointerPath(error: ErrorObject): string {
	const segments = error.instancePath
		.split('/')
		.slice(1)
		.map(segment => segment.replace(/~1/g, '/').replace(/~0/g, '~'));
	if (error.keyword === 'required') {
		const missing = (error.params as {missingProperty?: string})
			.missingProperty;
		if (missing !== undefined) segments.push(missing);
	}
	return segments.reduce((path, segment) => {
		if (/^(0|[1-9]\d*)$/.test(segment)) return `${path}[${segment}]`;
		return path ? `${path}.${segment}` : segment;
	}, '');
}

function validationErrors(
	errors: ErrorObject[] | null | undefined,
): ValidationErrorDetail[] {
	return (errors ?? []).map(error => ({
		path: pointerPath(error),
		message: error.message ?? `must satisfy the ${error.keyword} constraint`,
	}));
}

/**
 * Load a schema from the flag value. A value starting with `{` or `[` is
 * inline JSON; anything else is a file path. Inline is checked first so a
 * typo in the JSON reports the parse error rather than "file not found".
 */
export async function loadJsonSchema(
	rawValue: string,
): Promise<JsonSchemaDocument> {
	const value = rawValue.trim();
	if (!value) {
		throw new Error(
			'--json-schema requires a schema file path or inline JSON.',
		);
	}

	const inline = value.startsWith('{') || value.startsWith('[');
	let source = value;
	if (!inline) {
		try {
			source = readFileSync(value, 'utf8').replace(/^\uFEFF/, '');
		} catch (error) {
			throw new Error(
				`Could not read --json-schema file "${value}": ${errorMessage(error)}`,
			);
		}
	}

	let parsed: unknown;
	try {
		parsed = JSON.parse(source);
	} catch (error) {
		const where = inline ? 'inline JSON' : `file "${value}"`;
		throw new Error(
			`Could not parse --json-schema ${where}: ${errorMessage(error)}`,
		);
	}

	if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
		throw new Error(
			'--json-schema must contain a JSON object at the root (a schema such as {"type":"object"}).',
		);
	}

	const schema = parsed as JsonSchemaDocument;
	try {
		await compileSchema(schema);
	} catch (error) {
		throw new Error(`Invalid --json-schema: ${errorMessage(error)}`);
	}
	return schema;
}

/**
 * Parse the final answer as one JSON document. A single surrounding markdown
 * code fence is tolerated and stripped: small models add one even when asked
 * not to, and retrying for that alone wastes a turn.
 */
export function parseJsonDocument(
	text: string,
): {ok: true; value: unknown} | {ok: false; error: string} {
	const trimmed = text.trim();
	if (!trimmed) return {ok: false, error: 'the answer was empty'};

	const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
	const body = fenced ? fenced[1].trim() : trimmed;
	if (!body) return {ok: false, error: 'the answer was empty'};

	try {
		return {ok: true, value: JSON.parse(body)};
	} catch (error) {
		return {ok: false, error: errorMessage(error)};
	}
}

/** Parse and validate one final answer. */
export async function validateStructuredOutput(
	text: string,
	schema: JsonSchemaDocument,
): Promise<StructuredOutputValidation> {
	const parsed = parseJsonDocument(text);
	if (!parsed.ok) {
		return {ok: false, errors: [], parseError: parsed.error};
	}
	const validate = await compileSchema(schema);
	const valid = validate(parsed.value);
	const errors = validationErrors(validate.errors);
	return {ok: valid, value: parsed.value, errors};
}

/** Turn a failed validation into one readable sentence for the retry prompt. */
export function describeStructuredOutputFailure(
	result: StructuredOutputValidation,
): string {
	if (result.parseError) {
		return `the answer is not a single valid JSON document: ${result.parseError}`;
	}
	const shown = result.errors.slice(0, 8).map(error => {
		const location = error.path ?? '(root)';
		const detail =
			error.message ??
			`expected ${error.expected ?? 'a valid value'}, received ${error.received ?? 'an unexpected value'}`;
		return `${location}: ${detail}`;
	});
	const remaining = result.errors.length - shown.length;
	return `${shown.join('; ')}${remaining > 0 ? `; and ${remaining} more problem${remaining === 1 ? '' : 's'}` : ''}`;
}

/** The correction sent back after an answer fails validation. */
export function schemaCorrectionMessage(problem: string): string {
	return [
		'Your final answer did not validate against the required JSON Schema.',
		`Problem: ${problem}`,
		'Return only one JSON document that fixes this. Do not wrap it in markdown code fences and do not add any prose before or after it.',
	].join('\n');
}

/** The instruction appended to the system prompt when a schema is active. */
export function schemaInstruction(schema: JsonSchemaDocument): string {
	return [
		'## Structured output',
		'Your final answer must be a single JSON document that validates against the JSON Schema below.',
		'Return only the JSON document: no markdown code fences, and no prose before or after it.',
		'When you have enough information, answer with the JSON document instead of calling more tools.',
		'',
		'```json',
		JSON.stringify(schema, null, 2),
		'```',
	].join('\n');
}
