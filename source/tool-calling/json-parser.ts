import type {ToolCall} from '@/types/index';
import {ensureString} from '@/utils/type-helpers';

type ToolCallShape = {
	name?: string;
	arguments?: Record<string, unknown>;
};

function isToolCallShape(value: unknown): value is ToolCallShape {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		return false;
	}

	const parsed = value as ToolCallShape;
	return (
		typeof parsed.name === 'string' &&
		parsed.arguments !== undefined &&
		parsed.arguments !== null &&
		typeof parsed.arguments === 'object' &&
		!Array.isArray(parsed.arguments)
	);
}

function toToolCall(parsed: ToolCallShape, index = 0): ToolCall {
	return {
		id: `call_${Date.now()}_${index}`,
		function: {
			name: parsed.name || '',
			arguments: parsed.arguments || {},
		},
	};
}

export function detectMalformedJSONToolCall(
	content: unknown,
): {error: string; examples: string} | null {
	const contentStr = ensureString(content);
	const patterns = [
		{
			regex: /(?:^|\n)\s*\{\s*"name"\s*:\s*"[^"]+"\s*,?\s*\}/,
			error: 'Incomplete tool call: missing "arguments" field',
		},
		{
			regex: /(?:^|\n)\s*\{\s*"arguments"\s*:\s*\{[^}]*\}\s*\}/,
			error: 'Incomplete tool call: missing "name" field',
		},
		{
			regex:
				/(?:^|\n)\s*\{\s*"name"\s*:\s*"[^"]+"\s*,\s*"arguments"\s*:\s*"[^"]*"\s*\}/,
			error: 'Invalid tool call: "arguments" must be an object, not a string',
		},
	];

	for (const pattern of patterns) {
		if (pattern.regex.test(contentStr)) {
			return {
				error: pattern.error,
				examples:
					'Please use the native tool calling format provided by the system. The tools are already available to you - call them directly using the function calling interface.',
			};
		}
	}

	return null;
}

export function parseJSONToolCalls(content: unknown): ToolCall[] {
	const contentStr = ensureString(content);
	let trimmedContent = contentStr.trim();

	const codeBlockMatch = trimmedContent.match(
		/^```(?:json)?\s*\n?([\s\S]*?)\n?```$/,
	);
	if (codeBlockMatch?.[1]) {
		trimmedContent = codeBlockMatch[1].trim();
	}

	if (trimmedContent.startsWith('{') && trimmedContent.endsWith('}')) {
		if (trimmedContent.replace(/\s/g, '') === '{}') {
			return [];
		}

		try {
			const parsed = JSON.parse(trimmedContent);
			if (isToolCallShape(parsed)) {
				return [toToolCall(parsed)];
			}
		} catch {
			// Fall through to regex-based scanning.
		}
	}

	const extractedCalls: ToolCall[] = [];
	const patterns = [
		/\{\s*\n\s*"name":\s*"([^"]+)",\s*\n\s*"arguments":\s*\{[\s\S]*?\}\s*\n\s*\}/g,
		/\{"name":\s*"([^"]+)",\s*"arguments":\s*(\{[\s\S]*?\})\}/g,
	];

	for (const pattern of patterns) {
		let match: RegExpExecArray | null;
		while ((match = pattern.exec(contentStr)) !== null) {
			try {
				const parsed = JSON.parse(match[0]);
				if (isToolCallShape(parsed)) {
					extractedCalls.push(toToolCall(parsed, extractedCalls.length));
				}
			} catch {
				// Ignore malformed JSON here; malformed detection runs separately.
			}
		}
	}

	return extractedCalls;
}

export function cleanJSONToolCalls(
	content: unknown,
	toolCalls: ToolCall[],
): string {
	const contentStr = ensureString(content);
	if (toolCalls.length === 0) return contentStr;

	return contentStr
		.replace(
			/```(?:json)?\s*\n?([\s\S]*?)\n?```/g,
			(match, blockContent: string) => {
				try {
					const parsed = JSON.parse(blockContent.trim());
					return isToolCallShape(parsed) ? '' : match;
				} catch {
					return match;
				}
			},
		)
		.replace(
			/\{\s*\n\s*"name":\s*"([^"]+)",\s*\n\s*"arguments":\s*\{[\s\S]*?\}\s*\n\s*\}/g,
			'',
		)
		.replace(/\{"name":\s*"([^"]+)",\s*"arguments":\s*(\{[\s\S]*?\})\}/g, '')
		.replace(/[ \t]+$/gm, '')
		.replace(/^[ \t]+$/gm, '')
		.replace(/\n{3,}/g, '\n\n')
		.trim();
}
