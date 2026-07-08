import {scrub} from '@nanocollective/prompt-scrub';

import {Box, Text} from 'ink';
import {useTheme} from '@/hooks/useTheme';

import type {Command} from '@/types/index';
import {errorMsg, infoMsg} from '@/utils/message-factory';

export const privacyCommand: Command = {
	name: 'privacy',
	description:
		'Inspect what the prompt scrubber will remove from your prompts. Usage: /privacy inspect <text>',
	handler: async (args: string[]) => {
		if (args.length === 0) {
			return infoMsg(
				'Usage: /privacy inspect <text>\nExample: /privacy inspect my email is test@example.com',
				'privacy',
			);
		}

		const subCommand = args[0];

		if (subCommand === 'inspect') {
			const text = args.slice(1).join(' ');
			if (!text) {
				return errorMsg('Please provide text to inspect.', 'privacy');
			}

			// Scrub the input using a stateless map
			const result = scrub({
				content: text,
				sessionMap: {},
				options: {disabledDetectors: ['PathDetector', 'UrlDetector']},
			});

			// Collect the replacements map
			const map = result.sessionMap || {};
			const replacements = Object.entries(map).map(
				([placeholder, original]) => ({
					placeholder,
					original: original as string,
				}),
			);

			if (replacements.length === 0) {
				return infoMsg(
					'No sensitive identifiers detected in the input.',
					'privacy',
				);
			}

			return (
				<PrivacyInspectResult
					original={text}
					scrubbed={result.scrubbedContent as string}
					replacements={replacements}
				/>
			);
		}

		return errorMsg(
			`Unknown subcommand: ${subCommand}. Available subcommands: inspect`,
			'privacy',
		);
	},
};

function PrivacyInspectResult({
	original,
	scrubbed,
	replacements,
}: {
	original: string;
	scrubbed: string;
	replacements: Array<{placeholder: string; original: string}>;
}) {
	const {colors} = useTheme();

	return (
		<Box
			flexDirection="column"
			gap={1}
			padding={1}
			borderStyle="round"
			borderColor={colors.primary}
		>
			<Text color={colors.primary} bold>
				Privacy Inspect Result
			</Text>

			<Box flexDirection="column">
				<Text color={colors.secondary} bold>
					Original:
				</Text>
				<Text>{original}</Text>
			</Box>

			<Box flexDirection="column">
				<Text color={colors.secondary} bold>
					Scrubbed (Sent to LLM):
				</Text>
				<Text>{scrubbed}</Text>
			</Box>

			<Box flexDirection="column">
				<Text color={colors.secondary} bold>
					Detected Identifiers ({replacements.length}):
				</Text>
				{replacements.map(({placeholder, original}, idx) => (
					<Text key={idx}>
						<Text color="yellow">{placeholder}</Text> ↔{' '}
						<Text color={colors.primary}>{original}</Text>
					</Text>
				))}
			</Box>
		</Box>
	);
}
