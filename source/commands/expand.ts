/**
 * /expand command
 * Prints one tool result in full, past the transcript's line cap. Without a
 * number it lists the recent results that can be expanded.
 */
import {TOOL_OUTPUT_DISPLAY_LINES} from '@/constants';
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

function summarizeToolCall(toolCall: ToolCall): string {
	try {
		const args = parseToolArguments(toolCall.function.arguments);
		const value = SUMMARY_ARG_KEYS.map(key => args[key]).find(
			arg => typeof arg === 'string',
		);
		return value ? ` ${value}` : '';
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
			const rows = results
				.slice(-TOOL_OUTPUT_DISPLAY_LINES)
				.map(
					({id, toolCall, result}) =>
						`  ${id}  ${result.name}${summarizeToolCall(toolCall)}`,
				);
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
