/**
 * Ask User Question Tool
 *
 * Allows the AI to interactively ask the user questions during execution.
 * This is used for gathering preferences, clarifying requirements, and making decisions.
 *
 * Compatible with Claude Code's AskUserQuestion schema.
 */

import {Box, Text} from 'ink';
import type {NanocoderToolExport} from '@/types/core';
import {jsonSchema, tool} from '@/types/core';
import {getLogger} from '@/utils/logging';
import {triggerQuestionPrompt} from '@/utils/question-selection-registry';

/**
 * Schema for a single question option
 */
interface QuestionOption {
	label: string;
	description: string;
}

/**
 * Schema for a single question
 */
interface Question {
	question: string;
	header: string;
	options: QuestionOption[];
	multiSelect: boolean;
}

/**
 * Schema for the tool arguments
 */
interface AskUserQuestionArgs {
	questions: Question[];
}

/**
 * Validate the questions array
 */
function validateQuestions(questions: Question[]): {valid: true} | {valid: false; error: string} {
	if (!Array.isArray(questions)) {
		return {valid: false, error: 'Questions must be an array'};
	}

	if (questions.length < 1 || questions.length > 4) {
		return {valid: false, error: 'Must provide 1-4 questions'};
	}

	for (let i = 0; i < questions.length; i++) {
		const q = questions[i];
		const questionNum = i + 1;

		if (!q.question || typeof q.question !== 'string') {
			return {valid: false, error: `Question ${questionNum}: must have a "question" string`};
		}

		if (!q.question.endsWith('?')) {
			return {valid: false, error: `Question ${questionNum}: question must end with "?"`};
		}

		if (!q.header || typeof q.header !== 'string') {
			return {valid: false, error: `Question ${questionNum}: must have a "header" string`};
		}

		if (q.header.length > 12) {
			return {valid: false, error: `Question ${questionNum}: header must be 12 chars or less`};
		}

		if (q.multiSelect === undefined) {
			return {valid: false, error: `Question ${questionNum}: must specify "multiSelect"`};
		}

		if (!Array.isArray(q.options) || q.options.length < 2 || q.options.length > 4) {
			return {valid: false, error: `Question ${questionNum}: must have 2-4 options`};
		}

		for (let j = 0; j < q.options.length; j++) {
			const opt = q.options[j];
			if (!opt.label || typeof opt.label !== 'string') {
				return {valid: false, error: `Question ${questionNum}, Option ${j + 1}: must have a "label" string`};
			}

			if (!opt.description || typeof opt.description !== 'string') {
				return {valid: false, error: `Question ${questionNum}, Option ${j + 1}: must have a "description" string`};
			}
		}
	}

	return {valid: true};
}

/**
 * Execute the ask_user_question tool
 */
const executeAskUserQuestion = async (args: AskUserQuestionArgs): Promise<string> => {
	const logger = getLogger();
	const {questions} = args;

	logger.info('[ASK_USER_QUESTION] Tool called', {
		questionCount: questions.length,
		questions: questions.map((q) => ({question: q.question, header: q.header})),
	});

	// Validate questions
	const validation = validateQuestions(questions);
	if (!validation.valid) {
		const errorMsg = `Invalid questions: ${validation.error}`;
		logger.error('[ASK_USER_QUESTION] Validation failed', {error: validation.error});
		throw new Error(errorMsg);
	}

	// Trigger the interactive question prompt
	const questionTriggered = triggerQuestionPrompt(
		questions,
		(answers: Record<string, string>) => {
			// User submitted their answers
			logger.info('[ASK_USER_QUESTION] User submitted answers', {answers});
		},
		() => {
			// User cancelled
			logger.info('[ASK_USER_QUESTION] User cancelled');
		},
	);

	if (questionTriggered) {
		// Return a brief message while waiting for user input
		const questionPreview = questions
			.map((q) => `  [${q.header}] ${q.question}`)
			.join('\n');

		return `I need to ask you ${questions.length} question${questions.length > 1 ? 's' : ''}:\n\n${questionPreview}\n\nPlease answer the question${questions.length > 1 ? 's' : ''} in the interactive prompt above.`;
	}

	logger.warn('[ASK_USER_QUESTION] No question callback registered - falling back to text mode');
	// No callback registered - provide fallback text interface
	const fallbackQuestions = questions
		.map((q, i) => {
			const optionsStr = q.options
				.map((opt, j) => `  ${j + 1}. ${opt.label}: ${opt.description}`)
				.join('\n');
			return `${i + 1}. ${q.question}\n\n${optionsStr}`;
		})
		.join('\n\n');

	return `I need to ask you ${questions.length} question${questions.length > 1 ? 's' : ''}:\n\n${fallbackQuestions}\n\nPlease respond with your choice(s).`;
};

const askUserQuestionCoreTool = tool({
	description:
		'Ask the user questions interactively during execution. Use this to gather user preferences, clarify ambiguous instructions, get decisions on implementation choices, or offer choices about what direction to take. Users will always be able to select "Other" to provide custom text input. Use multiSelect: true to allow multiple answers for a question. If you recommend a specific option, make it the first option in the list and add "(Recommended)" at the end of the label.',
	inputSchema: jsonSchema<AskUserQuestionArgs>({
		type: 'object',
		properties: {
		questions: {
			type: 'array',
			description: 'Questions to ask the user (1-4 questions)',
			minItems: 1,
			maxItems: 4,
			items: {
				type: 'object',
				properties: {
					question: {
						type: 'string',
						description:
							'The complete question to ask the user. Should be clear, specific, and end with a question mark.',
					},
					header: {
						type: 'string',
						description: 'Very short label displayed as a chip/tag (max 12 chars).',
					},
					options: {
						type: 'array',
						description:
							'The available choices for this question. Must have 2-4 options. Each option should be a distinct, mutually exclusive choice (unless multiSelect is enabled).',
						minItems: 2,
						maxItems: 4,
						items: {
							type: 'object',
							properties: {
								label: {
									type: 'string',
									description:
										'The display text for this option. Should be concise (1-5 words) and clearly describe the choice.',
								},
								description: {
									type: 'string',
									description:
										'Explanation of what this option means or what will happen if chosen.',
								},
							},
							required: ['label', 'description'],
						},
					},
					multiSelect: {
						type: 'boolean',
						description:
							'Set to true to allow the user to select multiple options instead of just one.',
					},
				},
				required: ['question', 'header', 'options', 'multiSelect'],
			},
		},
	},
	required: ['questions'],
}),
	needsApproval: false, // User interaction is the approval
	execute: async (args: AskUserQuestionArgs, _options: {toolCallId: string; messages: unknown[]}) => {
		return await executeAskUserQuestion(args);
	},
});

export const askUserQuestionTool: NanocoderToolExport = {
	name: 'ask_user_question',
	tool: askUserQuestionCoreTool,
	formatter: async (args: AskUserQuestionArgs) => {
		// Default formatter shows the questions in a formatted way
		const {questions} = args;
		const questionElements = questions.map((q, i) => {
			const optionElements = q.options.map((opt, j) => (
				<Text key={j}>
					{'    '}
					{j + 1}. {opt.label}
					{q.multiSelect && ' (can select multiple)'}
				</Text>
			));

			return (
				<Box key={i} flexDirection="column" marginBottom={1}>
					<Text>
						{i + 1}. [<Text color="cyan">{q.header}</Text>] {q.question}
					</Text>
					{optionElements}
				</Box>
			);
		});

		return (
			<Box flexDirection="column">
				<Text bold>Questions:</Text>
				{questionElements}
			</Box>
		);
	},
	validator: async (args: AskUserQuestionArgs) => {
		const validation = validateQuestions(args.questions);
		if (validation.valid) {
			return {valid: true};
		}
		return validation;
	},
};
