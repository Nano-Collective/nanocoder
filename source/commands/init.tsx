import {existsSync, mkdirSync, writeFileSync} from 'fs';
import {Box, Text} from 'ink';
import {join} from 'path';
import React from 'react';
import {ErrorMessage} from '@/components/message-box';
import {TitledBoxWithPreferences} from '@/components/ui/titled-box';
import {getColors} from '@/config/index';
import {useTerminalWidth} from '@/hooks/useTerminalWidth';
import {AgentsTemplateGenerator} from '@/init/agents-template-generator';
import {ExistingRulesExtractor} from '@/init/existing-rules-extractor';
import {ProjectAnalyzer} from '@/init/project-analyzer';
import {generateKey} from '@/session/key-generator';
import {Command} from '@/types/index';

function InitSuccess({
	created,
	analysis,
}: {
	created: string[];
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
		'Initialize nanocoder configuration and analyze project structure. Use --force to regenerate AGENTS.md, --lean to skip CLAUDE.md when generating AGENTS.md.',
	handler: (args: string[], _messages, _metadata) => {
		const cwd = process.cwd();
		const created: string[] = [];
		const forceRegenerate = args.includes('--force') || args.includes('-f');
		// --lean: skip Claude-Code-specific source files (CLAUDE.md) when
		// generating AGENTS.md. Keeps the generated AGENTS.md smaller and
		// reduces duplication for users who already have CLAUDE.md.
		const lean = args.includes('--lean');

		try {
			// Check if already initialized
			const agentsPath = join(cwd, 'AGENTS.md');
			const nanocoderDir = join(cwd, '.nanocoder');

			// Check for existing initialization
			const hasAgents = existsSync(agentsPath);
			const hasNanocoder = existsSync(nanocoderDir);

			if (hasAgents && hasNanocoder && !forceRegenerate) {
				return Promise.resolve(
					React.createElement(InitError, {
						key: generateKey('init-error'),
						message:
							'Project already initialized. Found AGENTS.md and .nanocoder/ directory. Use /init --force to regenerate.',
					}),
				);
			}

			// Show progress indicator for analysis
			// Note: In a real implementation, we'd want to show this as a loading state
			// For now, we'll do the analysis synchronously

			// Analyze the project
			const analyzer = new ProjectAnalyzer(cwd);
			const analysis = analyzer.analyze();

			// Extract existing AI configuration files (skip AGENTS.md when force
			// regenerating; skip CLAUDE.md in lean mode).
			const rulesExtractor = new ExistingRulesExtractor(
				cwd,
				forceRegenerate,
				lean ? ['CLAUDE.md'] : [],
			);
			const existingRules = rulesExtractor.extractExistingRules();

			// Create AGENTS.md based on analysis and existing rules
			if (!hasAgents || forceRegenerate) {
				const agentsContent = AgentsTemplateGenerator.generateAgentsMd(
					analysis,
					existingRules,
				);
				writeFileSync(agentsPath, agentsContent);
				created.push(hasAgents ? 'AGENTS.md (regenerated)' : 'AGENTS.md');

				// Report found existing rules
				if (existingRules.length > 0) {
					const sourceFiles = existingRules.map(r => r.source).join(', ');
					created.push(`↳ Merged content from: ${sourceFiles}`);
				}
			}

			if (!hasNanocoder) {
				mkdirSync(nanocoderDir, {recursive: true});
				created.push('.nanocoder/');
			}

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
					created,
					analysis: analysisSummary,
				}),
			);
		} catch (error: unknown) {
			const errorMessage =
				error instanceof Error ? error.message : 'Unknown error';
			return Promise.resolve(
				React.createElement(InitError, {
					key: generateKey('init-error'),
					message: `Failed to initialize project: ${errorMessage}`,
				}),
			);
		}
	},
};
