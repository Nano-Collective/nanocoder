import type {ValidationErrorDetail} from '@/types/core';
import {matchSchemaPattern} from './schema-pattern.js';

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
export interface JsonSchemaNode {
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

// ============================================================================
// Strict document validation
// ============================================================================
//
// `validateArgsAgainstSchema` above is intentionally lenient: it only catches
// structured-where-scalar mistakes in tool arguments, because a false positive
// there blocks a call the model could otherwise make. A user-supplied
// `--json-schema` is a different contract: the final answer is a document a
// script will consume, so missing fields, extra fields and scalar mismatches
// are all failures. This validator implements the subset of JSON Schema that
// structured-output users need, and reports every problem with a path.

/**
 * The JSON Schema keywords this validator understands. Anything else is
 * ignored, so an unsupported annotation never rejects a valid document.
 */
export interface JsonSchemaDocument {
	$ref?: string;
	$defs?: Record<string, JsonSchemaDocument>;
	definitions?: Record<string, JsonSchemaDocument>;
	type?: string | string[];
	enum?: unknown[];
	const?: unknown;
	properties?: Record<string, JsonSchemaDocument>;
	required?: string[];
	additionalProperties?: boolean | JsonSchemaDocument;
	patternProperties?: Record<string, JsonSchemaDocument>;
	items?: JsonSchemaDocument | JsonSchemaDocument[];
	prefixItems?: JsonSchemaDocument[];
	additionalItems?: JsonSchemaDocument;
	minItems?: number;
	maxItems?: number;
	uniqueItems?: boolean;
	minProperties?: number;
	maxProperties?: number;
	minimum?: number;
	maximum?: number;
	exclusiveMinimum?: number;
	exclusiveMaximum?: number;
	multipleOf?: number;
	minLength?: number;
	maxLength?: number;
	pattern?: string;
	anyOf?: JsonSchemaDocument[];
	oneOf?: JsonSchemaDocument[];
	allOf?: JsonSchemaDocument[];
	not?: JsonSchemaDocument;
	[key: string]: unknown;
}

const MAX_STRICT_DEPTH = 64;
const MAX_STRICT_DETAILS = 20;

function isJsonObject(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Deep equality for JSON values, used by enum/const/uniqueItems. */
function jsonEqual(left: unknown, right: unknown): boolean {
	if (left === right) return true;
	if (Array.isArray(left) || Array.isArray(right)) {
		if (!Array.isArray(left) || !Array.isArray(right)) return false;
		return (
			left.length === right.length &&
			left.every((item, index) => jsonEqual(item, right[index]))
		);
	}
	if (isJsonObject(left) && isJsonObject(right)) {
		const leftKeys = Object.keys(left);
		const rightKeys = Object.keys(right);
		return (
			leftKeys.length === rightKeys.length &&
			leftKeys.every(
				key => Object.hasOwn(right, key) && jsonEqual(left[key], right[key]),
			)
		);
	}
	return false;
}

/** Strict type matching, unlike the lenient `matchesType` above. */
function matchesStrictType(value: unknown, type: string): boolean {
	switch (type) {
		case 'string':
			return typeof value === 'string';
		case 'number':
			return typeof value === 'number' && Number.isFinite(value);
		case 'integer':
			return typeof value === 'number' && Number.isInteger(value);
		case 'boolean':
			return typeof value === 'boolean';
		case 'array':
			return Array.isArray(value);
		case 'object':
			return isJsonObject(value);
		case 'null':
			return value === null;
		default:
			// Unknown type keyword → don't flag.
			return true;
	}
}

function strictTypes(schema: JsonSchemaDocument): string[] {
	if (Array.isArray(schema.type)) {
		return schema.type.filter(
			(type): type is string => typeof type === 'string',
		);
	}
	return typeof schema.type === 'string' ? [schema.type] : [];
}

function describePath(path: string): string {
	return path || '(root)';
}

function addStrictError(
	out: ValidationErrorDetail[],
	path: string,
	message: string,
	expected?: string,
	received?: string,
): void {
	if (out.length >= MAX_STRICT_DETAILS) return;
	out.push({
		path: describePath(path),
		message,
		...(expected !== undefined ? {expected} : {}),
		...(received !== undefined ? {received} : {}),
	});
}

function decodePointerSegment(segment: string): string {
	return segment.replace(/~1/g, '/').replace(/~0/g, '~');
}

/** Resolve a local JSON Pointer (`#`, `#/$defs/x`, `#/definitions/x`). */
function resolveLocalRef(
	ref: string,
	root: JsonSchemaDocument,
): JsonSchemaDocument | undefined {
	if (ref === '#') return root;
	if (!ref.startsWith('#/')) return undefined;
	let current: unknown = root;
	for (const segment of ref.slice(2).split('/').map(decodePointerSegment)) {
		if (!isJsonObject(current) || !Object.hasOwn(current, segment)) {
			return undefined;
		}
		current = current[segment];
	}
	return isJsonObject(current) ? (current as JsonSchemaDocument) : undefined;
}

function childPath(path: string, key: string | number): string {
	return typeof key === 'number'
		? `${path}[${key}]`
		: path
			? `${path}.${key}`
			: key;
}

function validateStrict(
	value: unknown,
	schema: unknown,
	path: string,
	root: JsonSchemaDocument,
	depth: number,
	out: ValidationErrorDetail[],
): void {
	if (out.length >= MAX_STRICT_DETAILS) return;
	if (depth > MAX_STRICT_DEPTH) {
		addStrictError(out, path, 'schema nesting is too deep to validate');
		return;
	}
	// Boolean schemas are part of JSON Schema: true accepts anything, false
	// rejects everything.
	if (schema === true) return;
	if (schema === false) {
		addStrictError(out, path, 'value is not allowed by the schema');
		return;
	}
	if (!isJsonObject(schema)) return;
	const node = schema as JsonSchemaDocument;

	// Local references. Draft-07 semantics: keywords next to `$ref` are
	// ignored, which also prevents a recursive schema from looping forever.
	if (typeof node.$ref === 'string') {
		const target = resolveLocalRef(node.$ref, root);
		if (!target) {
			addStrictError(
				out,
				path,
				`schema $ref "${node.$ref}" could not be resolved (only local #/… refs are supported)`,
			);
			return;
		}
		validateStrict(value, target, path, root, depth + 1, out);
		return;
	}

	if (Array.isArray(node.allOf)) {
		for (const sub of node.allOf) {
			validateStrict(value, sub, path, root, depth + 1, out);
		}
	}

	if (Array.isArray(node.anyOf) && node.anyOf.length > 0) {
		const anyValid = node.anyOf.some(sub => {
			const errors: ValidationErrorDetail[] = [];
			validateStrict(value, sub, path, root, depth + 1, errors);
			return errors.length === 0;
		});
		if (!anyValid) {
			addStrictError(
				out,
				path,
				`value does not match any schema in anyOf (${node.anyOf.length} branches)`,
			);
		}
	}

	if (Array.isArray(node.oneOf) && node.oneOf.length > 0) {
		const matches = node.oneOf.filter(sub => {
			const errors: ValidationErrorDetail[] = [];
			validateStrict(value, sub, path, root, depth + 1, errors);
			return errors.length === 0;
		}).length;
		if (matches !== 1) {
			addStrictError(
				out,
				path,
				`value must match exactly one schema in oneOf (matched ${matches})`,
			);
		}
	}

	if (node.not !== undefined) {
		const errors: ValidationErrorDetail[] = [];
		validateStrict(value, node.not, path, root, depth + 1, errors);
		if (errors.length === 0) {
			addStrictError(out, path, 'value must not match the schema in "not"');
		}
	}

	if (Object.hasOwn(node, 'const') && !jsonEqual(value, node.const)) {
		addStrictError(
			out,
			path,
			`value must equal ${JSON.stringify(node.const)}`,
			JSON.stringify(node.const),
			JSON.stringify(value),
		);
	}

	if (
		Array.isArray(node.enum) &&
		!node.enum.some(candidate => jsonEqual(value, candidate))
	) {
		addStrictError(
			out,
			path,
			`value must be one of ${node.enum.map(item => JSON.stringify(item)).join(', ')}`,
			node.enum.map(item => JSON.stringify(item)).join(' | '),
			JSON.stringify(value),
		);
	}

	const types = strictTypes(node);
	if (types.length > 0 && !types.some(type => matchesStrictType(value, type))) {
		addStrictError(
			out,
			path,
			`expected ${types.join(' | ')}`,
			types.join(' | '),
			describeType(value),
		);
		// The value's structure is wrong; descending would produce noise.
		return;
	}

	if (typeof value === 'string') {
		const length = [...value].length;
		if (typeof node.minLength === 'number' && length < node.minLength) {
			addStrictError(
				out,
				path,
				`string must be at least ${node.minLength} character${node.minLength === 1 ? '' : 's'} long`,
			);
		}
		if (typeof node.maxLength === 'number' && length > node.maxLength) {
			addStrictError(
				out,
				path,
				`string must be at most ${node.maxLength} character${node.maxLength === 1 ? '' : 's'} long`,
			);
		}
		if (typeof node.pattern === 'string') {
			const match = matchSchemaPattern(value, node.pattern);
			if (!match.supported) {
				addStrictError(
					out,
					path,
					`schema pattern is unsupported: ${match.reason}`,
				);
			} else if (!match.matched) {
				addStrictError(
					out,
					path,
					`string must match the pattern ${node.pattern}`,
				);
			}
		}
	}

	if (typeof value === 'number' && Number.isFinite(value)) {
		if (typeof node.minimum === 'number' && value < node.minimum) {
			addStrictError(out, path, `number must be >= ${node.minimum}`);
		}
		if (typeof node.maximum === 'number' && value > node.maximum) {
			addStrictError(out, path, `number must be <= ${node.maximum}`);
		}
		if (
			typeof node.exclusiveMinimum === 'number' &&
			value <= node.exclusiveMinimum
		) {
			addStrictError(out, path, `number must be > ${node.exclusiveMinimum}`);
		}
		if (
			typeof node.exclusiveMaximum === 'number' &&
			value >= node.exclusiveMaximum
		) {
			addStrictError(out, path, `number must be < ${node.exclusiveMaximum}`);
		}
		if (typeof node.multipleOf === 'number' && node.multipleOf > 0) {
			const quotient = value / node.multipleOf;
			if (Math.abs(quotient - Math.round(quotient)) > 1e-9) {
				addStrictError(
					out,
					path,
					`number must be a multiple of ${node.multipleOf}`,
				);
			}
		}
	}

	if (Array.isArray(value)) {
		if (typeof node.minItems === 'number' && value.length < node.minItems) {
			addStrictError(
				out,
				path,
				`array must contain at least ${node.minItems} item${node.minItems === 1 ? '' : 's'}`,
			);
		}
		if (typeof node.maxItems === 'number' && value.length > node.maxItems) {
			addStrictError(
				out,
				path,
				`array must contain at most ${node.maxItems} item${node.maxItems === 1 ? '' : 's'}`,
			);
		}
		if (node.uniqueItems === true) {
			for (let left = 0; left < value.length; left++) {
				for (let right = left + 1; right < value.length; right++) {
					if (jsonEqual(value[left], value[right])) {
						addStrictError(
							out,
							childPath(path, right),
							`array items must be unique (duplicates ${childPath(path, left)})`,
						);
						left = value.length;
						break;
					}
				}
			}
		}

		const tuple = Array.isArray(node.prefixItems)
			? node.prefixItems
			: Array.isArray(node.items)
				? node.items
				: undefined;
		const rest = Array.isArray(node.items) ? node.additionalItems : node.items;
		for (let index = 0; index < value.length; index++) {
			const sub = tuple && index < tuple.length ? tuple[index] : rest;
			if (sub !== undefined) {
				validateStrict(
					value[index],
					sub,
					childPath(path, index),
					root,
					depth + 1,
					out,
				);
			}
		}
	}

	if (isJsonObject(value)) {
		const keys = Object.keys(value);
		if (
			typeof node.minProperties === 'number' &&
			keys.length < node.minProperties
		) {
			addStrictError(
				out,
				path,
				`object must contain at least ${node.minProperties} propert${node.minProperties === 1 ? 'y' : 'ies'}`,
			);
		}
		if (
			typeof node.maxProperties === 'number' &&
			keys.length > node.maxProperties
		) {
			addStrictError(
				out,
				path,
				`object must contain at most ${node.maxProperties} propert${node.maxProperties === 1 ? 'y' : 'ies'}`,
			);
		}

		if (Array.isArray(node.required)) {
			for (const key of node.required) {
				if (typeof key === 'string' && !Object.hasOwn(value, key)) {
					addStrictError(
						out,
						childPath(path, key),
						`missing required property "${key}"`,
						'required property',
						'missing',
					);
				}
			}
		}

		const properties = isJsonObject(node.properties)
			? (node.properties as Record<string, JsonSchemaDocument>)
			: {};
		for (const [key, sub] of Object.entries(properties)) {
			if (Object.hasOwn(value, key)) {
				validateStrict(
					value[key],
					sub,
					childPath(path, key),
					root,
					depth + 1,
					out,
				);
			}
		}

		const matchedPatterns = new Set<string>();
		if (isJsonObject(node.patternProperties)) {
			for (const [pattern, sub] of Object.entries(node.patternProperties)) {
				const probe = matchSchemaPattern('', pattern);
				if (!probe.supported) {
					addStrictError(
						out,
						path,
						`schema patternProperties pattern is unsupported: ${probe.reason}`,
					);
					continue;
				}
				for (const key of keys) {
					const match = matchSchemaPattern(key, pattern);
					if (!match.supported) continue;
					if (!match.matched) continue;
					matchedPatterns.add(key);
					validateStrict(
						value[key],
						sub,
						childPath(path, key),
						root,
						depth + 1,
						out,
					);
				}
			}
		}

		if (node.additionalProperties === false) {
			for (const key of keys) {
				if (Object.hasOwn(properties, key) || matchedPatterns.has(key)) {
					continue;
				}
				addStrictError(
					out,
					childPath(path, key),
					`property "${key}" is not allowed by additionalProperties`,
				);
			}
		} else if (isJsonObject(node.additionalProperties)) {
			for (const key of keys) {
				if (Object.hasOwn(properties, key) || matchedPatterns.has(key)) {
					continue;
				}
				validateStrict(
					value[key],
					node.additionalProperties,
					childPath(path, key),
					root,
					depth + 1,
					out,
				);
			}
		}
	}
}

/**
 * Validate a complete JSON document against a user-supplied schema.
 *
 * Unlike `validateArgsAgainstSchema`, this enforces `required`,
 * `additionalProperties`, value constraints and `anyOf`/`oneOf`/`allOf`, and
 * resolves local `$ref`s. Errors carry a path (`issues[0].line`, `(root)`) so
 * they can be fed back to the model as a correction.
 */
export function validateJsonDocument(
	value: unknown,
	schema: JsonSchemaDocument | boolean,
): ValidationErrorDetail[] {
	const out: ValidationErrorDetail[] = [];
	validateStrict(value, schema, '', isJsonObject(schema) ? schema : {}, 0, out);
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
