import type {ValidationErrorDetail} from '@/types/core';

/**
 * Conservative, dependency-free type checker for tool arguments against the
 * tool's declared JSON schema. The goal is to catch the failure mode that
 * actually breaks things — a model emitting a structured value (object/array)
 * where a scalar string/number/boolean is expected, or a non-array where an
 * array is expected — and return a clear error so the model self-corrects,
 * rather than letting the bad value reach execution/rendering.
 *
 * It is deliberately LENIENT on scalar↔scalar (e.g. the string "5" for a
 * number) to avoid false positives on common model habits; it only flags
 * high-confidence type errors. Value constraints (min/max/length/pattern) are
 * intentionally NOT enforced here — those stay in per-tool validators.
 */

// Minimal structural view of the bits of JSON Schema 7 we inspect. Anything we
// don't recognise is treated as "no constraint" so we never false-positive.
interface JsonSchemaNode {
	type?: string | string[];
	enum?: unknown[];
	properties?: Record<string, JsonSchemaNode>;
	items?: JsonSchemaNode;
	// anyOf/oneOf/$ref etc. are intentionally ignored (skip → lenient).
}

const MAX_DEPTH = 5;
const MAX_ARRAY_SCAN = 50;
const MAX_DETAILS = 12;

function describeType(value: unknown): string {
	if (value === null) return 'null';
	if (Array.isArray(value)) return 'array';
	return typeof value;
}

/** Whether `value` satisfies a single JSON Schema primitive `type` keyword. */
function matchesType(value: unknown, type: string): boolean {
	switch (type) {
		case 'string':
		case 'number':
		case 'integer':
		case 'boolean':
			// Scalar expected: accept any non-structured, non-null value. This
			// rejects objects/arrays/null (the real bugs) while tolerating
			// scalar↔scalar mismatches (e.g. "5" for a number).
			return value !== null && typeof value !== 'object';
		case 'array':
			return Array.isArray(value);
		case 'object':
			return (
				value !== null && typeof value === 'object' && !Array.isArray(value)
			);
		case 'null':
			return value === null;
		default:
			// Unknown type keyword → don't flag.
			return true;
	}
}

function typesOf(schema: JsonSchemaNode): string[] {
	if (Array.isArray(schema.type)) return schema.type;
	if (typeof schema.type === 'string') return [schema.type];
	return [];
}

function checkValue(
	value: unknown,
	schema: JsonSchemaNode,
	path: string,
	depth: number,
	out: ValidationErrorDetail[],
): void {
	if (out.length >= MAX_DETAILS || depth > MAX_DEPTH) return;
	if (value === undefined) return; // presence is handled by per-tool validators

	const types = typesOf(schema);

	// Type check (only when a concrete type is declared).
	if (types.length > 0 && !types.some(t => matchesType(value, t))) {
		out.push({
			path,
			expected: types.join(' | '),
			received: describeType(value),
		});
		return; // structure mismatched — don't descend into it
	}

	// Enum membership (scalars only; comparing structured values is unreliable).
	if (
		Array.isArray(schema.enum) &&
		value !== null &&
		typeof value !== 'object' &&
		!schema.enum.includes(value)
	) {
		out.push({
			path,
			expected: `one of ${schema.enum.map(v => JSON.stringify(v)).join(', ')}`,
			received: JSON.stringify(value),
		});
		return;
	}

	// Recurse into array elements.
	if (Array.isArray(value) && schema.items) {
		const limit = Math.min(value.length, MAX_ARRAY_SCAN);
		for (let i = 0; i < limit; i++) {
			checkValue(value[i], schema.items, `${path}[${i}]`, depth + 1, out);
			if (out.length >= MAX_DETAILS) return;
		}
		return;
	}

	// Recurse into object properties that are present.
	if (
		schema.properties &&
		value !== null &&
		typeof value === 'object' &&
		!Array.isArray(value)
	) {
		const obj = value as Record<string, unknown>;
		for (const [key, propSchema] of Object.entries(schema.properties)) {
			if (key in obj) {
				const childPath = path ? `${path}.${key}` : key;
				checkValue(obj[key], propSchema, childPath, depth + 1, out);
				if (out.length >= MAX_DETAILS) return;
			}
		}
	}
}

/**
 * Type-check parsed tool arguments against a JSON schema. Returns one detail
 * per high-confidence type error (empty array when the args look well-typed or
 * the schema is too complex to check confidently).
 */
export function validateArgsAgainstSchema(
	args: unknown,
	schema: JsonSchemaNode | undefined,
): ValidationErrorDetail[] {
	if (!schema || typeof schema !== 'object') return [];
	const out: ValidationErrorDetail[] = [];
	checkValue(args, schema, '', 0, out);
	return out;
}

/**
 * Pull the raw JSON Schema out of an AI SDK tool's `inputSchema`. Tools built
 * with `jsonSchema(...)` expose it as `inputSchema.jsonSchema`. Returns
 * undefined for anything else (or a promise-like / non-object), so callers
 * simply skip schema validation rather than risk a false positive.
 */
export function getToolJsonSchema(tool: unknown): JsonSchemaNode | undefined {
	const input = (tool as {inputSchema?: unknown} | undefined)?.inputSchema;
	if (!input || typeof input !== 'object') return undefined;
	const js = (input as {jsonSchema?: unknown}).jsonSchema;
	if (!js || typeof js !== 'object') return undefined;
	if ('then' in (js as object)) return undefined; // promise-like — skip
	return js as JsonSchemaNode;
}
