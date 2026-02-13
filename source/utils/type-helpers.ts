// source/utils/type-helpers.ts

/**
 * Type-safe helper utilities for handling non-string content
 *
 * This module provides type guards and conversion functions that:
 * 1. Accept unknown types (string, object, array, null, undefined)
 * 2. Convert to appropriate types for processing
 * 3. Preserve types in memory (critical for ToolCall.arguments)
 * 4. Provide safe fallbacks for edge cases
 *
 * TYPE PRESERVATION STRATEGY
 * ===========================
 *
 * "Preserving types" means:
 * 1. When receiving LLM responses (which can be ANY type):
 *    - We accept unknown types (string, object, array, null, undefined)
 *    - We convert to string ONLY for PARSING OPERATIONS
 *    - We preserve the original type in the tool call structure
 *
 * 2. When storing ToolCall.arguments:
 *    - MUST preserve as Record<string, unknown> (object type)
 *    - NOT convert to string
 *    - Enables direct property access without JSON.parse
 *
 * 3. When displaying/writing to disk:
 *    - Convert to string for display/storage operations
 *    - Use JSON.stringify for objects/arrays
 *    - Use String() for primitives
 *
 * The confusion comes from mixing up:
 * - "Preserve types in memory" (CRITICAL: ToolCall.arguments stays as object)
 * - "Convert to string for processing" (NECESSARY: Parser expects strings)
 */

// ============================================================================
// TYPE GUARDS
// ============================================================================

/**
 * Type guard to check if value is a string
 *
 * @param value - Value to check
 * @returns True if value is a string, false otherwise
 */
export function isString(value: unknown): value is string {
	return typeof value === 'string';
}

/**
 * Type guard to check if value is a non-null object
 *
 * @param value - Value to check
 * @returns True if value is a non-null object, false otherwise
 */
export function isObject(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Type guard to check if value is an array
 *
 * @param value - Value to check
 * @returns True if value is an array, false otherwise
 */
export function isArray(value: unknown): value is unknown[] {
	return Array.isArray(value);
}

/**
 * Type guard to check if value is a plain object (not null, not array, not instance)
 *
 * @param value - Value to check
 * @returns True if value is a plain object, false otherwise
 */
export function isPlainObject(
	value: unknown,
): value is Record<string, unknown> {
	if (value === null || typeof value !== 'object') {
		return false;
	}

	// Check for prototype chain
	const prototype = Object.getPrototypeOf(value);
	return prototype === null || prototype === Object.prototype;
}

/**
 * Type guard to check if value is a valid function
 *
 * @param value - Value to check
 * @returns True if value is a function, false otherwise
 */
export function isFunction(value: unknown): value is Function {
	return typeof value === 'function';
}

/**
 * Type guard to check if value is a valid number
 *
 * @param value - Value to check
 * @returns True if value is a number, false otherwise
 */
export function isNumber(value: unknown): value is number {
	return typeof value === 'number' && !isNaN(value) && isFinite(value);
}

/**
 * Type guard to check if value is a valid boolean
 *
 * @param value - Value to check
 * @returns True if value is a boolean, false otherwise
 */
export function isBoolean(value: unknown): value is boolean {
	return typeof value === 'boolean';
}

/**
 * Type guard to check if value is a valid null value
 *
 * @param value - Value to check
 * @returns True if value is null, false otherwise
 */
export function isNull(value: unknown): value is null {
	return value === null;
}

/**
 * Type guard to check if value is undefined
 *
 * @param value - Value to check
 * @returns True if value is undefined, false otherwise
 */
export function isUndefined(value: unknown): value is undefined {
	return value === undefined;
}

// ============================================================================
// STRING CONVERSION FUNCTIONS
// ============================================================================

/**
 * Converts unknown value to a required string
 *
 * This function is used for:
 * 1. PARSING OPERATIONS - where strings are required
 * 2. INTERNAL PROCESSING - where we need to ensure string type
 *
 * The original type is NOT preserved in memory - this is for processing-only.
 * Type preservation happens in the ToolCall structure itself.
 *
 * @param value - Value to convert (unknown type)
 * @returns String representation of the value
 *
 * @example
 * ```typescript
 * // LLM passes object
 * const response = {path: "/tmp/test.txt", content: "hello"};
 *
 * // Convert to string for parsing
 * const contentStr = toRequiredString(response);
 * // contentStr = '{"path": "/tmp/test.txt", "content": "hello"}'
 *
 * // Parse tool calls
 * const toolCalls = parseToolCalls(contentStr);
 * // ToolCall.arguments preserved as object in memory
 * ```
 */
export function toRequiredString(value: unknown): string {
	// Handle null/undefined
	if (value === null || value === undefined) {
		return '';
	}

	// Handle string - return as-is
	if (isString(value)) {
		return value;
	}

	// Handle number - convert to string
	if (isNumber(value)) {
		return String(value);
	}

	// Handle boolean - convert to string
	if (isBoolean(value)) {
		return String(value);
	}

	// Handle array - convert to JSON string
	if (isArray(value)) {
		return JSON.stringify(value);
	}

	// Handle object - convert to JSON string
	if (isObject(value)) {
		return JSON.stringify(value);
	}

	// Fallback for unknown types
	return String(value);
}

/**
 * Ensures value is a string for display/storage operations
 *
 * This function is used for:
 * 1. DISPLAY OPERATIONS - where we need to display content
 * 2. STORAGE OPERATIONS - where we write to disk
 *
 * For display/storage, we convert to string. For parsing, use toRequiredString().
 *
 * @param value - Value to convert (unknown type)
 * @returns String representation of the value
 *
 * @example
 * ```typescript
 * // ToolCall.arguments is an object in memory
 * const toolCall = {
 *   function: {
 *     name: 'write_file',
 *     arguments: {path: "/tmp/test.txt", content: "hello"}
 *   }
 * };
 *
 * // For storage, convert to string
 * const contentStr = ensureString(toolCall.function.arguments);
 * // contentStr = '{"path": "/tmp/test.txt", "content": "hello"}'
 *
 * await writeFile(path, contentStr, 'utf-8');
 * ```
 */
export function ensureString(value: unknown): string {
	// Handle null/undefined
	if (value === null || value === undefined) {
		return '';
	}

	// Handle string - return as-is
	if (isString(value)) {
		return value;
	}

	// Handle number - convert to string
	if (isNumber(value)) {
		return String(value);
	}

	// Handle boolean - convert to string
	if (isBoolean(value)) {
		return String(value);
	}

	// Handle array - convert to JSON string
	if (isArray(value)) {
		return JSON.stringify(value);
	}

	// Handle object - convert to JSON string
	if (isObject(value)) {
		return JSON.stringify(value);
	}

	// Fallback for unknown types
	return String(value);
}

/**
 * Safely converts value to string with custom formatting
 *
 * This function allows for custom string conversion strategies
 * while maintaining type safety.
 *
 * @param value - Value to convert (unknown type)
 * @param options - Conversion options
 * @returns String representation of the value
 */
export function toStringSafe(
	value: unknown,
	options: ToStringOptions = {},
): string {
	const {
		fallback = '',
		indent = 0, // Changed from 2 to 0 for compact output
	} = options;

	// Handle null/undefined
	if (value === null || value === undefined) {
		return fallback;
	}

	// Handle string - return as-is
	if (isString(value)) {
		return value;
	}

	// Handle number - convert to string
	if (isNumber(value)) {
		return String(value);
	}

	// Handle boolean - convert to string
	if (isBoolean(value)) {
		return String(value);
	}

	// Handle array - convert to JSON string
	if (isArray(value)) {
		return JSON.stringify(value, null, indent);
	}

	// Handle object - convert to JSON string
	if (isObject(value)) {
		return JSON.stringify(value, null, indent);
	}

	// Fallback for unknown types
	return fallback;
}

/**
 * Converts value to JSON string for display/storage
 *
 * This is a specialized version of ensureString that:
 * 1. Uses JSON.stringify with custom spacing
 * 2. Handles circular references (throws error)
 * 3. Handles special values (null, undefined, etc.)
 *
 * @param value - Value to convert (unknown type)
 * @param options - JSON.stringify options
 * @returns JSON string representation of the value
 */
export function toJSONString(
	value: unknown,
	options: JSONStringifyOptions = {},
): string {
	const {
		indent = 0, // Changed from 2 to 0 for compact output
		replacer = null,
		spaceAfterComma = true,
	} = options;

	// Handle null/undefined
	if (value === null || value === undefined) {
		return 'null';
	}

	// Handle string - return as-is
	if (isString(value)) {
		return value;
	}

	// Handle number - convert to string
	if (isNumber(value)) {
		return String(value);
	}

	// Handle boolean - convert to string
	if (isBoolean(value)) {
		return String(value);
	}

	// Handle array - convert to JSON string
	if (isArray(value)) {
		const arrayReplacer = (key: string, val: unknown): unknown => {
			if (replacer) {
				return replacer(key, val);
			}
			return val;
		};

		const json = JSON.stringify(value, arrayReplacer, indent);
		return spaceAfterComma ? json.replace(/,\s*([}\]])/g, '$1') : json;
	}

	// Handle object - convert to JSON string
	if (isObject(value)) {
		const objectReplacer = (key: string, val: unknown): unknown => {
			if (replacer) {
				return replacer(key, val);
			}
			return val;
		};

		const json = JSON.stringify(value, objectReplacer, indent);
		return spaceAfterComma ? json.replace(/,\s*([}\]])/g, '$1') : json;
	}

	// Fallback for unknown types
	return 'null';
}

// ============================================================================
// TYPE EXTRACTION FUNCTIONS
// ============================================================================

/**
 * Safely extracts a string value from unknown object
 *
 * @param obj - Object to extract from (unknown type)
 * @param key - Key to extract
 * @param defaultValue - Default value if key not found
 * @returns Extracted string or default value
 */
export function getStringFromObject(
	obj: unknown,
	key: string,
	defaultValue: string = '',
): string {
	if (!isObject(obj)) {
		return defaultValue;
	}

	const value = obj[key];
	if (isString(value)) {
		return value;
	}

	return defaultValue;
}

/**
 * Safely extracts a number value from unknown object
 *
 * @param obj - Object to extract from (unknown type)
 * @param key - Key to extract
 * @param defaultValue - Default value if key not found
 * @returns Extracted number or default value
 */
export function getNumberFromObject(
	obj: unknown,
	key: string,
	defaultValue: number = 0,
): number {
	if (!isObject(obj)) {
		return defaultValue;
	}

	const value = obj[key];
	if (isNumber(value)) {
		return value;
	}

	return defaultValue;
}

/**
 * Safely extracts a boolean value from unknown object
 *
 * @param obj - Object to extract from (unknown type)
 * @param key - Key to extract
 * @param defaultValue - Default value if key not found
 * @returns Extracted boolean or default value
 */
export function getBooleanFromObject(
	obj: unknown,
	key: string,
	defaultValue: boolean = false,
): boolean {
	if (!isObject(obj)) {
		return defaultValue;
	}

	const value = obj[key];
	if (isBoolean(value)) {
		return value;
	}

	return defaultValue;
}

/**
 * Safely extracts an array value from unknown object
 *
 * @param obj - Object to extract from (unknown type)
 * @param key - Key to extract
 * @param defaultValue - Default value if key not found
 * @returns Extracted array or default value
 */
export function getArrayFromObject(
	obj: unknown,
	key: string,
	defaultValue: unknown[] = [],
): unknown[] {
	if (!isObject(obj)) {
		return defaultValue;
	}

	const value = obj[key];
	if (isArray(value)) {
		return value;
	}

	return defaultValue;
}

/**
 * Safely extracts an object value from unknown object
 *
 * @param obj - Object to extract from (unknown type)
 * @param key - Key to extract
 * @param defaultValue - Default value if key not found
 * @returns Extracted object or default value
 */
export function getObjectFromObject(
	obj: unknown,
	key: string,
	defaultValue: Record<string, unknown> = {},
): Record<string, unknown> {
	if (!isObject(obj)) {
		return defaultValue;
	}

	const value = obj[key];
	if (isObject(value)) {
		return value;
	}

	return defaultValue;
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Checks if value is empty (null, undefined, empty string, empty array, empty object)
 *
 * @param value - Value to check
 * @returns True if value is empty, false otherwise
 */
export function isEmpty(value: unknown): boolean {
	if (value === null || value === undefined) {
		return true;
	}

	if (isString(value)) {
		return value.trim().length === 0;
	}

	if (isArray(value)) {
		return value.length === 0;
	}

	if (isObject(value)) {
		return Object.keys(value).length === 0;
	}

	return false;
}

/**
 * Checks if value is non-empty (opposite of isEmpty)
 *
 * @param value - Value to check
 * @returns True if value is non-empty, false otherwise
 */
export function isNotEmpty(value: unknown): boolean {
	return !isEmpty(value);
}

/**
 * Clones a value safely, preserving type
 *
 * @param value - Value to clone
 * @returns Cloned value
 */
export function clone<T>(value: T): T {
	if (value === null || value === undefined) {
		return value;
	}

	if (isString(value)) {
		return value as T;
	}

	if (isNumber(value)) {
		return value as T;
	}

	if (isBoolean(value)) {
		return value as T;
	}

	if (isArray(value)) {
		return JSON.parse(JSON.stringify(value)) as T;
	}

	if (isObject(value)) {
		return JSON.parse(JSON.stringify(value)) as T;
	}

	return value;
}

/**
 * Gets the type name of a value
 *
 * @param value - Value to check
 * @returns Type name string
 */
export function getTypeName(value: unknown): string {
	if (value === null) {
		return 'null';
	}

	if (value === undefined) {
		return 'undefined';
	}

	if (isString(value)) {
		return 'string';
	}

	if (isNumber(value)) {
		return 'number';
	}

	if (isBoolean(value)) {
		return 'boolean';
	}

	if (isArray(value)) {
		return 'array';
	}

	if (isObject(value)) {
		return 'object';
	}

	return 'unknown';
}

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

export interface ToStringOptions {
	/** Fallback value for unknown types */
	fallback?: string;

	/** Indentation for arrays/objects */
	indent?: number;

	/** Space character for indentation */
	space?: string;
}

export interface JSONStringifyOptions {
	/** Indentation level */
	indent?: number;

	/** Space character for indentation */
	space?: string;

	/** Replacer function (same as JSON.stringify) */
	replacer?: (key: string, value: unknown) => unknown;

	/** Add space after commas before closing brackets */
	spaceAfterComma?: boolean;
}
