import type {
	CustomToolMetadata,
	CustomToolParameterDef,
	CustomToolParameterType,
} from '@/types/custom-tools';
import type {ToolValidator} from '@/types/index';

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
	return (
		args: Record<string, unknown>,
	): Promise<{valid: true} | {valid: false; error: string}> => {
		const input = (args ?? {}) as Record<string, unknown>;
		const params = metadata.parameters;

		for (const [name, def] of Object.entries(params)) {
			const provided = name in input;
			const value = input[name];
			if (!provided || value === undefined || value === null) {
				if (def.required) {
					return Promise.resolve({
						valid: false,
						error: `⚒ Missing required parameter: ${name}`,
					});
				}
				continue;
			}
			const err = checkValue(name, def, value);
			if (err) {
				return Promise.resolve({valid: false, error: err});
			}
		}
		return Promise.resolve({valid: true});
	};
}

function checkValue(
	name: string,
	def: CustomToolParameterDef,
	value: unknown,
): string | null {
	if (!matchesType(def.type, value)) {
		return `⚒ Parameter "${name}" has wrong type — expected ${def.type}, got ${describeType(value)}`;
	}

	if (def.enum && !def.enum.some(v => v === value)) {
		const choices = def.enum.map(v => JSON.stringify(v)).join(', ');
		return `⚒ Parameter "${name}" must be one of: ${choices}`;
	}

	if (def.type === 'string') {
		const s = value as string;
		if (def.minLength !== undefined && s.length < def.minLength) {
			return `⚒ Parameter "${name}" is too short (min ${def.minLength} chars)`;
		}
		if (def.maxLength !== undefined && s.length > def.maxLength) {
			return `⚒ Parameter "${name}" is too long (max ${def.maxLength} chars)`;
		}
		// `def.pattern` was length-capped (MAX_PATTERN_LENGTH) and compile-
		// validated in parser.ts when the tool was loaded. It comes from
		// project-owned .nanocoder/tools/*.md frontmatter, not attacker input.
		if (def.pattern !== undefined) {
			// nosemgrep: javascript.lang.security.audit.detect-non-literal-regexp.detect-non-literal-regexp
			const re = new RegExp(def.pattern);
			if (!re.test(s)) {
				return `⚒ Parameter "${name}" does not match pattern ${def.pattern}`;
			}
		}
	}

	if (def.type === 'number' || def.type === 'integer') {
		const n = value as number;
		if (def.min !== undefined && n < def.min) {
			return `⚒ Parameter "${name}" is below minimum (${def.min})`;
		}
		if (def.max !== undefined && n > def.max) {
			return `⚒ Parameter "${name}" is above maximum (${def.max})`;
		}
	}

	if (def.type === 'array' && def.items) {
		const arr = value as unknown[];
		for (let i = 0; i < arr.length; i++) {
			if (!matchesType(def.items.type, arr[i])) {
				return `⚒ Parameter "${name}[${i}]" has wrong type — expected ${def.items.type}, got ${describeType(arr[i])}`;
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
