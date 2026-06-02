import type {
	CustomToolMetadata,
	CustomToolParameterDef,
	CustomToolParameterType,
} from '@/types/custom-tools';
import type {ToolValidator, ValidationErrorDetail} from '@/types/index';

interface JsonSchemaProperty {
	type: CustomToolParameterType;
	description?: string;
	default?: unknown;
	enum?: unknown[];
	pattern?: string;
	minLength?: number;
	maxLength?: number;
	minimum?: number;
	maximum?: number;
	items?: {type: CustomToolParameterType};
}

export interface JsonSchema {
	type: 'object';
	properties: Record<string, JsonSchemaProperty>;
	required: string[];
	additionalProperties: false;
}

/**
 * Convert a custom tool's parameter declarations into a JSON Schema object
 * suitable for AI SDK `inputSchema`. One source of truth: the same
 * descriptions and constraints surface to the model and the validator.
 */
export function buildJsonSchema(metadata: CustomToolMetadata): JsonSchema {
	const properties: Record<string, JsonSchemaProperty> = {};
	const required: string[] = [];

	for (const [name, def] of Object.entries(metadata.parameters)) {
		properties[name] = buildProperty(def);
		if (def.required) required.push(name);
	}

	return {
		type: 'object',
		properties,
		required,
		additionalProperties: false,
	};
}

function buildProperty(def: CustomToolParameterDef): JsonSchemaProperty {
	const prop: JsonSchemaProperty = {type: def.type};
	if (def.description !== undefined) prop.description = def.description;
	if (def.default !== undefined) prop.default = def.default;
	if (def.enum !== undefined) prop.enum = def.enum;
	if (def.pattern !== undefined) prop.pattern = def.pattern;
	if (def.minLength !== undefined) prop.minLength = def.minLength;
	if (def.maxLength !== undefined) prop.maxLength = def.maxLength;
	if (def.min !== undefined) prop.minimum = def.min;
	if (def.max !== undefined) prop.maximum = def.max;
	if (def.items !== undefined) prop.items = def.items;
	return prop;
}

/**
 * Build a `ToolValidator` from the parameter declarations. Returns
 * emoji-prefixed errors that match the style of `webSearchValidator`.
 *
 * Validates: required-ness, type, enum, pattern, minLength/maxLength,
 * min/max. Unknown extra params are silently dropped (AI SDK behavior for
 * dynamic tool args).
 */
export function buildValidator(metadata: CustomToolMetadata): ToolValidator {
	return (args: Record<string, unknown>) => {
		const input = (args ?? {}) as Record<string, unknown>;
		const params = metadata.parameters;

		for (const [name, def] of Object.entries(params)) {
			const provided = name in input;
			const value = input[name];
			if (!provided || value === undefined || value === null) {
				if (def.required) {
					return Promise.resolve({
						valid: false as const,
						error: `⚒ Missing required parameter: ${name}`,
						details: [
							{path: name, expected: 'required', received: 'undefined'},
						],
					});
				}
				continue;
			}
			const failure = checkValue(name, def, value);
			if (failure) {
				return Promise.resolve({
					valid: false as const,
					error: failure.message,
					details: [failure.detail],
				});
			}
		}
		return Promise.resolve({valid: true as const});
	};
}

/**
 * A single failed check: the human-readable message (kept identical to the
 * historical wording) plus structured detail for self-correcting callers.
 */
function checkValue(
	name: string,
	def: CustomToolParameterDef,
	value: unknown,
): {message: string; detail: ValidationErrorDetail} | null {
	if (!matchesType(def.type, value)) {
		return {
			message: `⚒ Parameter "${name}" has wrong type — expected ${def.type}, got ${describeType(value)}`,
			detail: {path: name, expected: def.type, received: describeType(value)},
		};
	}

	if (def.enum && !def.enum.some(v => v === value)) {
		const choices = def.enum.map(v => JSON.stringify(v)).join(', ');
		return {
			message: `⚒ Parameter "${name}" must be one of: ${choices}`,
			detail: {
				path: name,
				expected: `one of ${choices}`,
				received: JSON.stringify(value),
			},
		};
	}

	if (def.type === 'string') {
		const s = value as string;
		if (def.minLength !== undefined && s.length < def.minLength) {
			return {
				message: `⚒ Parameter "${name}" is too short (min ${def.minLength} chars)`,
				detail: {
					path: name,
					expected: `length >= ${def.minLength}`,
					received: `length ${s.length}`,
				},
			};
		}
		if (def.maxLength !== undefined && s.length > def.maxLength) {
			return {
				message: `⚒ Parameter "${name}" is too long (max ${def.maxLength} chars)`,
				detail: {
					path: name,
					expected: `length <= ${def.maxLength}`,
					received: `length ${s.length}`,
				},
			};
		}
		// `def.pattern` was length-capped (MAX_PATTERN_LENGTH) and compile-
		// validated in parser.ts when the tool was loaded. It comes from
		// project-owned .nanocoder/tools/*.md frontmatter, not attacker input.
		if (def.pattern !== undefined) {
			// nosemgrep: javascript.lang.security.audit.detect-non-literal-regexp.detect-non-literal-regexp
			const re = new RegExp(def.pattern);
			if (!re.test(s)) {
				return {
					message: `⚒ Parameter "${name}" does not match pattern ${def.pattern}`,
					detail: {path: name, expected: `match /${def.pattern}/`},
				};
			}
		}
	}

	if (def.type === 'number' || def.type === 'integer') {
		const n = value as number;
		if (def.min !== undefined && n < def.min) {
			return {
				message: `⚒ Parameter "${name}" is below minimum (${def.min})`,
				detail: {path: name, expected: `>= ${def.min}`, received: String(n)},
			};
		}
		if (def.max !== undefined && n > def.max) {
			return {
				message: `⚒ Parameter "${name}" is above maximum (${def.max})`,
				detail: {path: name, expected: `<= ${def.max}`, received: String(n)},
			};
		}
	}

	if (def.type === 'array' && def.items) {
		const arr = value as unknown[];
		for (let i = 0; i < arr.length; i++) {
			if (!matchesType(def.items.type, arr[i])) {
				return {
					message: `⚒ Parameter "${name}[${i}]" has wrong type — expected ${def.items.type}, got ${describeType(arr[i])}`,
					detail: {
						path: `${name}[${i}]`,
						expected: def.items.type,
						received: describeType(arr[i]),
					},
				};
			}
		}
	}

	return null;
}

function matchesType(type: CustomToolParameterType, value: unknown): boolean {
	switch (type) {
		case 'string':
			return typeof value === 'string';
		case 'number':
			return typeof value === 'number' && Number.isFinite(value);
		case 'integer':
			return (
				typeof value === 'number' &&
				Number.isFinite(value) &&
				Number.isInteger(value)
			);
		case 'boolean':
			return typeof value === 'boolean';
		case 'array':
			return Array.isArray(value);
	}
}

function describeType(value: unknown): string {
	if (value === null) return 'null';
	if (Array.isArray(value)) return 'array';
	return typeof value;
}
