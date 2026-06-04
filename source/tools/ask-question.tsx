import {Box, Text} from 'ink';
import React from 'react';

import ToolMessage from '@/components/tool-message';
import {ThemeContext} from '@/hooks/useTheme';
import type {NanocoderToolExport} from '@/types/core';
import {jsonSchema, tool} from '@/types/core';
import {signalQuestion} from '@/utils/question-queue';
import {ensureString} from '@/utils/type-helpers';

interface AskQuestionArgs {
	question: string;
	options: string[];
	allowFreeform?: boolean;
}

/**
 * Models sometimes emit `options` as objects (e.g. `{value: "..."}` or
 * `{label: "..."}`) despite the schema asking for plain strings. Pull the
 * meaningful text out of common shapes so both the displayed option and the
 * answer returned to the model are clean strings — not JSON blobs.
 */
function toOptionString(opt: unknown): string {
	if (typeof opt === 'string') return opt;
	if (opt && typeof opt === 'object') {
		const o = opt as Record<string, unknown>;
		for (const key of ['value', 'label', 'text', 'title', 'name']) {
			if (typeof o[key] === 'string') return o[key] as string;
		}
	}
	return ensureString(opt);
}

const executeAskQuestion = async (args: AskQuestionArgs): Promise<string> => {
	const {allowFreeform = true} = args;
	const question = ensureString(args.question);
	const options = (Array.isArray(args.options) ? args.options : []).map(
		toOptionString,
	);

	if (options.length < 2 || options.length > 4) {
		return 'Error: ⚒ options must contain 2-4 items.';
	}

	const answer = await signalQuestion({
		question,
		options,
		allowFreeform,
	});

	return answer;
};

const askQuestionCoreTool = tool({
	description:
		'Ask the user a question with selectable options. Use when you need clarification, a decision between approaches, or user preference. The user sees the question with clickable options and can optionally type a custom answer. Returns the selected answer as a string. IMPORTANT: Never re-ask a question the user has already answered. Accept their response and proceed.',
	inputSchema: jsonSchema<AskQuestionArgs>({
		type: 'object',
		properties: {
			question: {
				type: 'string',
				description: 'The question to ask the user.',
			},
			options: {
				type: 'array',
				items: {type: 'string'},
				description:
					'2-4 selectable answer options for the user to choose from.',
			},
			allowFreeform: {
				type: 'boolean',
				description:
					'If true (default), adds a "Type custom answer..." option so the user can provide their own response.',
			},
		},
		required: ['question', 'options'],
	}),
	execute: async (args, _options) => {
		return await executeAskQuestion(args);
	},
});

interface AskQuestionFormatterProps {
	args: AskQuestionArgs;
	result?: string;
}

const AskQuestionFormatter = React.memo(
	({args, result}: AskQuestionFormatterProps) => {
		const themeContext = React.useContext(ThemeContext);
		if (!themeContext) {
			throw new Error('ThemeContext not found');
		}
		const {colors} = themeContext;

		const messageContent = (
			<Box flexDirection="column">
				<Text color={colors.tool}>⚒ ask_user</Text>
				<Box flexDirection="column" marginBottom={1}>
					<Text color={colors.secondary}>Question:</Text>
					<Box marginLeft={2}>
						<Text color={colors.text}>{ensureString(args.question)}</Text>
					</Box>
				</Box>
				{result && (
					<Box flexDirection="column">
						<Text color={colors.secondary}>Answer:</Text>
						<Box marginLeft={2}>
							<Text color={colors.text}>{result}</Text>
						</Box>
					</Box>
				)}
			</Box>
		);

		return <ToolMessage message={messageContent} hideBox={true} />;
	},
);

const askQuestionFormatter = (
	args: AskQuestionArgs,
	result?: string,
): React.ReactElement => {
	if (result && result.startsWith('Error:')) {
		return <></>;
	}
	return <AskQuestionFormatter args={args} result={result} />;
};

export const askQuestionTool: NanocoderToolExport = {
	name: 'ask_user' as const,
	tool: askQuestionCoreTool,
	formatter: askQuestionFormatter,
	// Asking the user a question is itself the interaction - never gated.
	approval: false,
};
