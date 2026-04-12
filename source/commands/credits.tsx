import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {Box, Text} from 'ink';
import React from 'react';
import {TitledBoxWithPreferences} from '@/components/ui/titled-box';
import {useTerminalWidth} from '@/hooks/useTerminalWidth';
import {useTheme} from '@/hooks/useTheme';
import type {Command} from '@/types/index';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function getContributors(): Promise<string[]> {
	try {
		const content = await readFile(
			path.join(__dirname, './contributors.json'),
			'utf8',
		);
		const data = JSON.parse(content) as {contributors: string[]};
		return data.contributors;
	} catch {
		return [];
	}
}

async function getDependencies(): Promise<
	Array<{name: string; version: string}>
> {
	try {
		const content = await readFile(
			path.join(__dirname, '../../package.json'),
			'utf8',
		);
		const packageJson = JSON.parse(content) as {
			dependencies?: Record<string, string>;
		};
		const deps = packageJson.dependencies ?? {};
		return Object.entries(deps)
			.map(([name, version]) => ({name, version: version.replace(/^\^/, '')}))
			.sort((a, b) => a.name.localeCompare(b.name));
	} catch {
		return [];
	}
}

function Credits({
	contributors,
	dependencies,
}: {
	contributors: string[];
	dependencies: Array<{name: string; version: string}>;
}) {
	const boxWidth = useTerminalWidth();
	const {colors} = useTheme();

	return (
		<TitledBoxWithPreferences
			title="Credits"
			width={boxWidth}
			borderColor={colors.primary}
			paddingX={2}
			paddingY={1}
			flexDirection="column"
			marginBottom={1}
		>
			<Box marginBottom={1}>
				<Text color={colors.text}>
					Nanocoder is built by the community, for the community. Every
					contribution matters and we want to credit everyone who has helped
					make this project what it is.
				</Text>
			</Box>

			<Box marginBottom={1}>
				<Text color={colors.primary} bold>
					Contributors
				</Text>
			</Box>
			{contributors.length === 0 ? (
				<Text color={colors.secondary}> No contributor data available.</Text>
			) : (
				contributors.map((name, index) => (
					<Text key={index} color={colors.text}>
						{' '}
						• {name}
					</Text>
				))
			)}

			<Box marginTop={1} marginBottom={1}>
				<Text color={colors.primary} bold>
					Dependencies
				</Text>
			</Box>
			{dependencies.map((dep, index) => (
				<Text key={index} color={colors.text}>
					{' '}
					• <Text color={colors.secondary}>{dep.name}</Text> {dep.version}
				</Text>
			))}
		</TitledBoxWithPreferences>
	);
}

export const creditsCommand: Command = {
	name: 'credits',
	description: 'Show project contributors and dependencies',
	handler: async () => {
		const [contributors, dependencies] = await Promise.all([
			getContributors(),
			getDependencies(),
		]);

		return React.createElement(Credits, {
			key: `credits-${Date.now()}`,
			contributors,
			dependencies,
		});
	},
};
