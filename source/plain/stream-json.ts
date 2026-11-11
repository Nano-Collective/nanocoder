/**
 * NDJSON event stream for `nanocoder run --output-format stream-json`.
 *
 * One JSON object per line on stdout, emitted as the plain conversation loop
 * runs, so CI jobs, editor integrations and wrapper scripts can follow
 * progress, tool calls and token usage without waiting for the run to end.
 * Human-readable output stays on stderr (see `source/plain/writer.ts`), so
 * stdout is machine-only in this mode. The final `result` event carries the
 * same report object `--json` prints today.
 */

export type StreamJsonEvent =
	| {
			type: 'session_start';
			sessionId: string;
			provider?: string;
			model?: string;
	  }
	| {
			type: 'assistant_text';
			/** 1-based model round-trip, matching `steps` in the final report. */
			turn: number;
			delta: string;
	  }
	| {
			type: 'tool_call';
			turn: number;
			name: string;
			arguments: Record<string, unknown>;
	  }
	| {
			type: 'tool_result';
			turn: number;
			name: string;
			isError: boolean;
			/** Truncated to {@link STREAM_JSON_TOOL_RESULT_MAX_CHARS}. */
			content: string | null;
	  }
	| {
			type: 'usage';
			turn: number;
			inputTokens: number;
			outputTokens: number;
			totalTokens: number;
			cacheReadTokens?: number;
			cacheWriteTokens?: number;
	  }
	| {
			type: 'result';
			kind: string;
			exitCode: number;
			finalText: string;
			reasoning: string | null;
			toolCalls: Array<{
				name: string;
				arguments: Record<string, unknown>;
				result: string | null;
				error: string | null;
			}>;
			steps: number;
			filesChanged: string[];
			warnings: string[];
			usage?: {
				inputTokens: number;
				outputTokens: number;
				totalTokens: number;
				cacheReadTokens?: number;
				cacheWriteTokens?: number;
			};
			message?: string;
			toolNames?: string[];
			autoAcceptWouldRun?: boolean;
	  };

export type StreamJsonEventSink = (event: StreamJsonEvent) => void;

/** Tool-result content is capped so one huge result cannot flood the stream. */
export const STREAM_JSON_TOOL_RESULT_MAX_CHARS = 2000;

export function truncateStreamJsonToolResult(
	content: string | null,
): string | null {
	if (content === null) return null;
	if (content.length <= STREAM_JSON_TOOL_RESULT_MAX_CHARS) return content;
	return (
		content.slice(0, STREAM_JSON_TOOL_RESULT_MAX_CHARS) +
		`\n…[truncated, ${content.length - STREAM_JSON_TOOL_RESULT_MAX_CHARS} more characters]`
	);
}

/**
 * Writes each event as one JSON line to stdout. A serialisation failure must
 * never fail the run, so it is reported on stderr and the event is dropped.
 */
export function createStdoutStreamJsonSink(): StreamJsonEventSink {
	return event => {
		try {
			process.stdout.write(`${JSON.stringify(event)}\n`);
		} catch (error) {
			process.stderr.write(
				`Error: Failed to serialize stream-json event: ${error instanceof Error ? error.message : String(error)}\n`,
			);
		}
	};
}
