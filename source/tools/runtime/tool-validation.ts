import {
	getToolJsonSchema,
	validateArgsAgainstSchema,
} from '@/tools/runtime/schema-validate';
import {parseToolArguments} from '@/tools/runtime/tool-args-parser';
import type {
	ToolCall,
	ToolExecutionContext,
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

const SCHEMA_TYPE_ERROR =
	'one or more arguments have the wrong type — fix the types and call the tool again';

/**
 * Wrap a tool handler so type-checking and its validator run immediately
 * before execution.
 *
 * This is the execution-time gate. Every path (interactive loop, plain
 * shell, subagents) invokes the registry handler, so validating here means
 * no path can bypass it. {@link precheckToolCall} runs the same checks
 * before the interactive approval prompt. On failure the wrapper throws a
 * {@link ToolValidationError}; callers already catch handler exceptions and
 * turn them into an error tool-result.
 *
 * When a `schema` is supplied, arguments are first type-checked against it.
 * A wrong-typed argument (e.g. an object where a string is expected) is
 * returned to the model as a structured error so it can correct itself and
 * retry — instead of the bad value reaching execution or the UI.
 */
export function withValidation(
	handler: ToolHandler,
	validator?: ToolValidator,
	schema?: Parameters<typeof validateArgsAgainstSchema>[1],
): ToolHandler {
	if (!validator && !schema) return handler;
	return async (args: unknown, options?: ToolExecutionContext) => {
		if (schema) {
			const typeErrors = validateArgsAgainstSchema(args, schema);
			if (typeErrors.length > 0) {
				throw new ToolValidationError(SCHEMA_TYPE_ERROR, typeErrors);
			}
		}
		if (validator) {
			const result = await validator(args);
			if (!result.valid) {
				throw new ToolValidationError(result.error, result.details);
			}
		}
		// `options` carries the turn's abort signal, plus the session id and
		// working directory the artifact tools need. Dropping it here would
		// silently un-cancel every tool that has a schema or a validator (which
		// is all of them): Stop/Escape would abort the model stream but a
		// running `execute_bash` or `agent` would keep going to completion.
		return handler(args, options);
	};
}

/**
 * The slice of a tool manager this check needs. Structural so this module
 * does not import `ToolManager`: that class is built on the validated
 * registry, which already imports this file.
 */
interface ToolCallPrecheckSource {
	getToolEntry(name: string): {tool?: unknown} | undefined;
	getToolValidator(name: string): ToolValidator | undefined;
}

/**
 * Run the schema check and the per-tool validator before a call is offered
 * for approval. Returns the string the model would see if the validated
 * handler had thrown, or null when the call can run.
 *
 * Nothing here executes the handler. A failure needs no consent (#1228):
 * the call is rejected and the error goes back to the model.
 */
export async function precheckToolCall(
	toolManager: ToolCallPrecheckSource | null,
	toolCall: ToolCall,
): Promise<string | null> {
	if (!toolManager) return null;

	// Lenient, matching the dialog's old preview: unparseable arguments stay
	// as given so the schema check or the validator can name the real problem.
	let parsedArgs: unknown = {};
	try {
		parsedArgs = parseToolArguments(toolCall.function.arguments);
	} catch {
		parsedArgs = {};
	}

	const schema = getToolJsonSchema(
		toolManager.getToolEntry(toolCall.function.name)?.tool,
	);
	if (schema) {
		const typeErrors = validateArgsAgainstSchema(parsedArgs, schema);
		if (typeErrors.length > 0) {
			return formatValidationError(SCHEMA_TYPE_ERROR, typeErrors);
		}
	}

	const validator = toolManager.getToolValidator(toolCall.function.name);
	if (!validator) return null;
	try {
		const result = await validator(parsedArgs);
		if (!result.valid) {
			return formatValidationError(result.error, result.details);
		}
	} catch (error) {
		return toolErrorToContent(error);
	}
	return null;
}
