import {Box, Text} from 'ink';
import React from 'react';
import {ErrorMessage} from '@/components/message-box';
import {TitledBoxWithPreferences} from '@/components/ui/titled-box';
import {getColors} from '@/config/index';
import {useTerminalWidth} from '@/hooks/useTerminalWidth';
import {parseInitArguments} from '@/init/init-args';
import {
	initializeProject,
	ProjectAlreadyInitializedError,
} from '@/init/initializer';
import {generateKey} from '@/session/key-generator';
import {Command} from '@/types/index';
import {formatError} from '@/utils/error-formatter';

function InitSuccess({
	created,
	preserved,
	preset,
	analysis,
}: {
	created: string[];
	preserved?: string[];
	preset?: string;
	analysis?: {
		projectType: string;
		primaryLanguage: string;
		frameworks: string[];
		totalFiles: number;
	};
}) {
	const colors = getColors();
	const boxWidth = useTerminalWidth();
	return (
		<TitledBoxWithPreferences
			title="Project Initialized"
			width={boxWidth}
			borderColor={colors.primary}
			paddingX={2}
			paddingY={1}
			flexDirection="column"
			marginBottom={1}
		>
			<Box marginBottom={1}>
				<Text color={colors.primary} bold>
					✓ Nanocoder project initialized successfully!
				</Text>
			</Box>
			{preset && <Text color={colors.secondary}>• Preset: {preset}</Text>}

			{analysis && (
				<>
					<Box marginBottom={1}>
						<Text color={colors.text} bold>
							Project Analysis:
						</Text>
					</Box>
					<Text color={colors.secondary}>• Type: {analysis.projectType}</Text>
					<Text color={colors.secondary}>
						• Primary Language: {analysis.primaryLanguage}
					</Text>
					{analysis.frameworks.length > 0 && (
						<Text color={colors.secondary}>
							• Frameworks: {analysis.frameworks.slice(0, 3).join(', ')}
						</Text>
					)}
					<Text color={colors.secondary}>
						• Files Analyzed: {analysis.totalFiles}
					</Text>
					<Box marginBottom={1} />
				</>
			)}

			<Box marginBottom={1}>
				<Text color={colors.text} bold>
					Files Created:
				</Text>
			</Box>

			{created.map((item, index) => (
				<Text key={index} color={colors.secondary}>
					• {item}
				</Text>
			))}

			{preserved && preserved.length > 0 && (
				<>
					<Box marginTop={1} marginBottom={1}>
						<Text color={colors.text} bold>
							Existing Files Preserved:
						</Text>
					</Box>
					{preserved.map(item => (
						<Text key={item} color={colors.secondary}>
							• {item}
						</Text>
					))}
				</>
			)}

			<Box marginTop={1} flexDirection="column">
				<Box marginBottom={1}>
					<Text color={colors.text}>
						Your project is now ready for AI-assisted development!
					</Text>
				</Box>
				<Text color={colors.secondary}>
					The AGENTS.md file will help AI understand your project context.
				</Text>
			</Box>
		</TitledBoxWithPreferences>
	);
}

function InitError({message}: {message: string}) {
	return <ErrorMessage hideBox={true} message={`✗ ${message}`} />;
}

export const initCommand: Command = {
	name: 'init',
	description:
		'Initialize nanocoder configuration and analyze project structure. Use --preset <react|nextjs|rust>, --force to regenerate AGENTS.md, or --lean to skip CLAUDE.md.',
	handler: (args: string[], _messages, _metadata) => {
		const cwd = process.cwd();

		try {
			const options = parseInitArguments(args);
			const result = initializeProject({projectPath: cwd, ...options});
			const {analysis} = result;

			// Prepare analysis summary for display
			const analysisSummary = {
				projectType: analysis.projectType,
				primaryLanguage: analysis.languages.primary?.name || 'Unknown',
				frameworks: analysis.dependencies.frameworks.map(
					(f: {name: string}) => f.name,
				),
				totalFiles: analysis.structure.scannedFiles,
			};

			return Promise.resolve(
				React.createElement(InitSuccess, {
					key: generateKey('init-success'),
					created: result.created,
					preserved: result.preserved,
					preset: result.preset,
					analysis: analysisSummary,
				}),
			);
		} catch (error: unknown) {
			const errorMessage =
				error instanceof ProjectAlreadyInitializedError
					? `${error.message} Use /init --force to regenerate.`
					: `Failed to initialize project: ${formatError(error)}`;
			return Promise.resolve(
				React.createElement(InitError, {
					key: generateKey('init-error'),
					message: errorMessage,
				}),
			);
		}
	},
};
