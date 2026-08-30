import {Box, Text} from 'ink';
import React from 'react';

import ToolMessage from '@/components/tool-message';
import {ThemeContext} from '@/hooks/useTheme';
import type {NanocoderToolExport} from '@/types/core';
import {jsonSchema, tool} from '@/types/core';
import type {QuestionOptionMeta, QuestionType} from '@/utils/question-queue';
import {signalQuestion} from '@/utils/question-queue';
import {ensureString, toOptionString} from '@/utils/type-helpers';

interface RichOption {
	label: string;
	description?: string;
	pros?: string[];
	cons?: string[];
}

interface AskQuestionArgs {
	question: string;
	options: Array<string | RichOption>;
	allowFreeform?: boolean;
	/** Optional type badge: 'ambiguity' | 'decision' | 'confirmation' */
	questionType?: QuestionType;
}

const executeAskQuestion = async (args: AskQuestionArgs): Promise<string> => {
	const {allowFreeform = true, questionType} = args;
	const question = ensureString(args.question);
	const rawOptions = Array.isArray(args.options) ? args.options : [];

	// Build flat string labels (always) and rich metadata (when available)
	const options: string[] = [];
	const optionMeta: QuestionOptionMeta[] = [];
	let hasRichMeta = false;

	for (const opt of rawOptions) {
		if (typeof opt === 'object' && opt !== null && 'label' in opt) {
			const rich = opt as RichOption;
			const label = ensureString(rich.label);
			options.push(label);
			// Normalise model-supplied fields: pros/cons must be string arrays and
			// description a string. Models sometimes emit a bare string (or other
			// shapes), which would otherwise crash the renderer (.map on a string).
			const toStringArray = (v: unknown): string[] | undefined => {
				if (Array.isArray(v)) return v.map(ensureString);
				if (typeof v === 'string' && v.trim()) return [v];
				return undefined;
			};
			optionMeta.push({
				label,
				description:
					rich.description === undefined
						? undefined
						: ensureString(rich.description),
				pros: toStringArray(rich.pros),
				cons: toStringArray(rich.cons),
			});
			hasRichMeta = true;
		} else {
			const label = toOptionString(opt);
			options.push(label);
			optionMeta.push({label});
		}
	}

	if (options.length < 2 || options.length > 6) {
		return 'Error: options must contain 2-6 items.';
	}

	const answer = await signalQuestion({
		question,
		options,
		allowFreeform,
		questionType,
		optionMeta: hasRichMeta ? optionMeta : undefined,
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
				// Accept plain strings or rich objects {label, description, pros, cons}.
				// Rich objects are used by plan mode for architectural decision questions.
				items: {type: ['string', 'object']},
				description:
					'2-6 selectable answer options. Each option can be a plain string or a rich object {label, description?, pros?, cons?} for architectural decision questions in plan mode.',
			},
			allowFreeform: {
				type: 'boolean',
				description:
					'If true (default), adds a "Type custom answer..." option so the user can provide their own response.',
			},
			questionType: {
				type: 'string',
				enum: ['ambiguity', 'decision', 'confirmation'],
				description:
					'Optional. Classifies the question: ambiguity, decision, or confirmation.',
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
