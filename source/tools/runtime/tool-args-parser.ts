/**
 * Parse tool arguments from various formats
 * Handles both string-encoded JSON and already-parsed objects
 *
 * This utility eliminates the repeated pattern of JSON parsing that appears
 * throughout the codebase when handling tool call arguments.
 *
 * ## Error Handling Modes
 *
 * **Lenient mode (strict=false, default)**: Used for display/UI purposes where
 * graceful degradation is acceptable. If JSON parsing fails, returns the
 * unparsed string, allowing the application to continue.
 *
 * **Strict mode (strict=true)**: Used for tool execution where malformed
 * arguments must be caught early. Throws an error if JSON parsing fails,
 * preventing execution with invalid data.
 *
 * @param args - Arguments in any format (string, object, etc.)
 * @param options - Parsing options
 * @param options.strict - If true, throw error on parse failure. If false, return unparsed value. Default: false
 * @returns Parsed arguments as the specified type
 * @throws Error if strict=true and JSON parsing fails
 *
 * @example
 * // Lenient parsing for display
 * const parsedArgs = parseToolArguments(toolCall.function.arguments);
 *
 * // Strict parsing for tool execution
 * const parsedArgs = parseToolArguments(toolCall.function.arguments, {strict: true});
 *
 * // With type parameter
 * const typedArgs = parseToolArguments<{path: string}>(args, {strict: true});
 */
export function parseToolArguments<T = Record<string, unknown>>(
	args: unknown,
	options: {strict?: boolean} = {},
): T {
	const {strict = false} = options;

	if (typeof args === 'string') {
		try {
			return JSON.parse(args) as T;
		} catch (e) {
			if (strict) {
				throw new Error(
					`Error: Invalid tool arguments: ${(e as Error).message}`,
				);
			}
			// If parsing fails in lenient mode, return as-is (will be cast to T)
			return args as T;
		}
	}
	return args as T;
}
