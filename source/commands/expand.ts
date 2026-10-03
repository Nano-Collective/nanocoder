/**
 * /expand command
 * Prints one tool result in full, past the transcript's line cap. Without a
 * number it lists the recent results that can be expanded.
 */
import {DEFAULT_TERMINAL_COLUMNS, TOOL_OUTPUT_DISPLAY_LINES} from '@/constants';
import {calculateBoxWidth} from '@/hooks/useTerminalWidth';
import {getToolManager} from '@/message-handler';
import type {Command} from '@/types/commands';
import type {ToolCall} from '@/types/core';
import {infoMsg, warningMsg} from '@/utils/message-factory';
import {parseToolArguments} from '@/utils/tool-args-parser';
import {
	getExpandableToolResults,
	renderExpandedToolResult,
} from '@/utils/tool-result-display';

const SUMMARY_ARG_KEYS = ['path', 'file_path', 'command', 'pattern', 'url'];

// The info box loses 1 column to each border plus paddingX={2} a side (see
// MessageBox), so this is the text width a listing row has to fit in.
const MESSAGE_BOX_CHROME = 6;
// Never cut a summary shorter than this, even on a very narrow terminal.
const MIN_SUMMARY_LENGTH = 10;

function availableRowWidth(): number {
	return (
		calculateBoxWidth(process.stdout.columns || DEFAULT_TERMINAL_COLUMNS) -
		MESSAGE_BOX_CHROME
	);
}

function summarizeToolCall(toolCall: ToolCall, maxLength: number): string {
	try {
		const args = parseToolArguments(toolCall.function.arguments);
		const value = SUMMARY_ARG_KEYS.map(key => args[key]).find(
			arg => typeof arg === 'string',
		);
		if (!value) return '';
		// Collapse whitespace so multi-line commands stay on one row, and cut
		// to the room left on the row so a long argument cannot wrap it.
		const collapsed = value.replace(/\s+/g, ' ').trim();
		const cap = Math.max(maxLength, MIN_SUMMARY_LENGTH);
		const truncated =
			collapsed.length > cap ? `${collapsed.slice(0, cap - 1)}…` : collapsed;
		return ` ${truncated}`;
	} catch {
		return '';
	}
}

export const expandCommand: Command = {
	name: 'expand',
	description:
		'Show one tool result in full (/expand <n>); run without a number to list recent results',
	handler: async args => {
		const results = getExpandableToolResults();
		if (results.length === 0) {
			return infoMsg('No tool results to expand yet.', 'expand');
		}

		const requested = args[0];
		if (requested === undefined) {
			const recent = results.slice(-TOOL_OUTPUT_DISPLAY_LINES);
			// Pad the id column so 9 and 10 keep the tool names aligned.
			const idWidth = Math.max(...recent.map(({id}) => String(id).length));
			const rowWidth = availableRowWidth();
			const rows = recent.map(({id, toolCall, result}) => {
				const prefix = `  ${String(id).padStart(idWidth)}  ${result.name}`;
				// 1 for the space summarizeToolCall puts before the argument.
				const room = rowWidth - prefix.length - 1;
				return `${prefix}${summarizeToolCall(toolCall, room)}`;
			});
			return infoMsg(
				`Recent tool results (run /expand <number>):\n${rows.join('\n')}`,
				'expand',
			);
		}

		const id = Number(requested.replace(/^#/, ''));
		const entry = results.find(result => result.id === id);
		if (!entry) {
			return warningMsg(
				`No tool result ${requested}. Run /expand to list recent results.`,
				'expand',
			);
		}

		return renderExpandedToolResult(entry, getToolManager());
	},
};
