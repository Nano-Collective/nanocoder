import type {
	ToolHandler,
	ToolValidator,
	ValidationErrorDetail,
} from '@/types/core';
import {formatError} from '@/utils/error-formatter';

/**
 * Thrown by a validated tool handler when its arguments fail validation.
 * Carries the structured details so callers can render a field-level message
 * for a self-correcting LLM rather than a flat sentence.
 */
export class ToolValidationError extends Error {
	readonly details?: ValidationErrorDetail[];

	constructor(message: string, details?: ValidationErrorDetail[]) {
		super(message);
		this.name = 'ToolValidationError';
		this.details = details;
	}
}

/**
 * Render a validation failure into the string that goes back to the model.
 * Appends one line per structured detail when present.
 */
export function formatValidationError(
	error: string,
	details?: ValidationErrorDetail[],
): string {
	const base = `⚒ Validation failed: ${error}`;
	if (!details || details.length === 0) {
		return base;
	}
	const lines = details.map(d => {
		const field = d.path ? `\`${d.path}\`` : 'argument';
		const parts: string[] = [];
		if (d.expected !== undefined) parts.push(`expected ${d.expected}`);
		if (d.received !== undefined) parts.push(`received ${d.received}`);
		const detail = parts.length > 0 ? `: ${parts.join(', ')}` : '';
		const extra = d.message ? ` (${d.message})` : '';
		return `  - ${field}${detail}${extra}`;
	});
	return `${base}\n${lines.join('\n')}`;
}

/**
 * Convert any error thrown during tool execution into the string content the
 * model sees. Validation failures get structured field-level formatting;
 * everything else falls back to the generic error message.
 */
export function toolErrorToContent(error: unknown): string {
	if (error instanceof ToolValidationError) {
		return formatValidationError(error.message, error.details);
	}
	return `Error: ${formatError(error)}`;
}

/**
 * Wrap a tool handler so its validator runs immediately before execution.
 *
 * This is the single place tool validation lives: because every execution
 * path (interactive loop, plain shell, subagents) ultimately invokes the
 * registry handler, validating here means no path can bypass it. On failure
 * the wrapper throws a {@link ToolValidationError}; callers already catch
 * handler exceptions and turn them into an error tool-result.
 */
export function withValidation(
	handler: ToolHandler,
	validator?: ToolValidator,
): ToolHandler {
	if (!validator) return handler;
	return async (args: unknown) => {
		const result = await validator(args);
		if (!result.valid) {
			throw new ToolValidationError(result.error, result.details);
		}
		return handler(args);
	};
}
