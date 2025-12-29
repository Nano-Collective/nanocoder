/**
 * Rule-based summarization - fast, free, deterministic
 * Extracts key facts from tool outputs using pattern matching
 */

import type {Message} from '@/types/core';
import {
	Summarizer,
	type SummarizerOptions,
	type SummaryResult,
} from '../summarizer';

export interface ToolSummary {
	toolName: string;
	status: 'success' | 'error' | 'partial';
	keyFacts: string[];
	metadata: Record<string, unknown>;
}

/**
 * Rule-based summarizer using pattern extraction and tool-specific logic
 */
export class RuleBasedSummarizer extends Summarizer {
	async summarize(
		messages: Message[],
		options: SummarizerOptions,
	): Promise<SummaryResult> {
		const summaries: string[] = [];
		let toolCount = 0;

		for (const message of messages) {
			if (message.role === 'tool') {
				const toolSummary = this.summarizeToolResult(message);
				summaries.push(this.formatToolSummary(toolSummary));
				toolCount++;
			} else if (message.role === 'user') {
				// Keep brief user messages
				const content =
					typeof message.content === 'string'
						? message.content.slice(0, 100)
						: '[complex content]';
				summaries.push(`User: ${content}`);
			}
		}

		const summary = `[Summarized ${toolCount} tool results]\n${summaries.join('\n')}`;

		return {
			summary,
			tokensUsed: Math.ceil(summary.length / 4),
			messagesProcessed: messages.length,
			mode: 'rule-based',
		};
	}

	private summarizeToolResult(message: Message): ToolSummary {
		const toolName = message.name || 'unknown';
		const content = typeof message.content === 'string' ? message.content : '';

		// Dispatch to tool-specific summarizer
		const summarizer = this.getToolSummarizer(toolName);
		return summarizer(content, message);
	}

	private getToolSummarizer(
		toolName: string,
	): (content: string, message: Message) => ToolSummary {
		const summarizers: Record<
			string,
			(content: string, message: Message) => ToolSummary
		> = {
			read_file: summarizeReadFile,
			execute_bash: summarizeBash,
			search_files: summarizeSearch,
			write_file: summarizeFileWrite,
			string_replace: summarizeFileEdit,
			create_file: summarizeFileWrite,
		};

		return summarizers[toolName] || defaultSummarizer;
	}

	private formatToolSummary(summary: ToolSummary): string {
		const status = summary.status === 'error' ? '❌' : '✓';
		const facts = summary.keyFacts.join(' | ');
		return `[${status} ${summary.toolName}: ${facts}]`;
	}
}

function summarizeReadFile(content: string, message: Message): ToolSummary {
	const lines = content.split('\n').length;
	const sizeKB = Math.round(content.length / 1024);
	const hasExports = content.includes('export ');

	return {
		toolName: 'read_file',
		status: 'success',
		keyFacts: [
			`Lines: ${lines}`,
			`Size: ${sizeKB}KB`,
			hasExports ? 'Exports' : 'No exports',
		],
		metadata: {lines, sizeKB, hasExports},
	};
}

function summarizeBash(content: string, _message: Message): ToolSummary {
	const hasError = /error|failed|exception|exit code (?!0)/i.test(content);
	const outputLines = content.split('\n').filter(l => l.trim()).length;

	return {
		toolName: 'execute_bash',
		status: hasError ? 'error' : 'success',
		keyFacts: [
			`Output: ${outputLines} lines`,
			hasError ? 'ERROR detected' : 'Success',
		],
		metadata: {hasError, outputLines},
	};
}

function summarizeSearch(content: string, _message: Message): ToolSummary {
	const matches = (content.match(/\n/g) || []).length; // Rough match count
	const hasResults = matches > 0;

	return {
		toolName: 'search',
		status: hasResults ? 'success' : 'partial',
		keyFacts: [
			`Matches: ${matches}`,
			hasResults ? 'Found results' : 'No results',
		],
		metadata: {matches, hasResults},
	};
}

function summarizeFileWrite(content: string, _message: Message): ToolSummary {
	const lines = content.split('\n').length;

	return {
		toolName: 'write_file',
		status: 'success',
		keyFacts: [`Lines: ${lines}`, 'File written'],
		metadata: {lines},
	};
}

function summarizeFileEdit(content: string, _message: Message): ToolSummary {
	const lines = content.split('\n').length;

	return {
		toolName: 'string_replace',
		status: 'success',
		keyFacts: [`Lines: ${lines}`, 'File edited'],
		metadata: {lines},
	};
}

function defaultSummarizer(content: string, message: Message): ToolSummary {
	const toolName = message.name || 'unknown';
	const lines = content.split('\n').filter(l => l.trim()).length;
	const hasError = /error|failed/i.test(content);

	return {
		toolName,
		status: hasError ? 'error' : 'success',
		keyFacts: [`Lines: ${lines}`, hasError ? 'ERROR' : 'OK'],
		metadata: {lines, hasError},
	};
}
