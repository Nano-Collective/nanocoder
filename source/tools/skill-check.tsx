import {Box, Text} from 'ink';
import React from 'react';
import ToolMessage from '@/components/tool-message';
import {ThemeContext} from '@/hooks/useTheme';
import {checkSkillBundle, formatSkillCheckReport} from '@/skills/check';
import type {NanocoderToolExport} from '@/types/core';
import {jsonSchema, tool} from '@/types/core';
import {formatError} from '@/utils/error-formatter';

interface CheckSkillArgs {
	name: string;
}

const executeCheckSkill = async (args: CheckSkillArgs): Promise<string> => {
	const name = (args.name ?? '').trim();
	if (!name) {
		throw new Error('check_skill requires a "name" (the skill bundle name).');
	}
	try {
		const report = await checkSkillBundle(process.cwd(), name);
		return formatSkillCheckReport(report);
	} catch (error: unknown) {
		throw new Error(`Failed to check skill: ${formatError(error)}`);
	}
};

const checkSkillCoreTool = tool({
	description:
		'Lint a bundle-form skill under .nanocoder/skills/<name>/ and report whether its skill.yaml and member files (commands/, agents/, tools/) are correctly formatted. Reads from disk, so it sees files just written this session. Returns PASS or FAIL with per-file errors and advisory warnings. Call this after authoring or editing a skill bundle and fix any reported errors until it reports PASS.',
	inputSchema: jsonSchema<CheckSkillArgs>({
		type: 'object',
		properties: {
			name: {
				type: 'string',
				description:
					'The skill bundle name (the directory under .nanocoder/skills/). Example: "pr-reviewer".',
			},
		},
		required: ['name'],
	}),
	execute: async (args, _options) => {
		return await executeCheckSkill(args);
	},
});

interface CheckSkillFormatterProps {
	args: CheckSkillArgs;
	result?: string;
}

const CheckSkillFormatter = React.memo(
	({args, result}: CheckSkillFormatterProps) => {
		const themeContext = React.useContext(ThemeContext);
		if (!themeContext) {
			throw new Error('ThemeContext not found');
		}
		const {colors} = themeContext;

		const passed = !!result && result.startsWith('PASS');

		const messageContent = (
			<Box flexDirection="column">
				<Text color={colors.tool}>⚒ check_skill</Text>

				<Box>
					<Text color={colors.secondary}>Skill: </Text>
					<Text color={colors.text}>{args.name}</Text>
				</Box>

				{result && (
					<Box marginTop={1}>
						<Text color={passed ? colors.success : colors.error}>{result}</Text>
					</Box>
				)}
			</Box>
		);

		return <ToolMessage message={messageContent} hideBox={true} />;
	},
);

const checkSkillFormatter = (
	args: CheckSkillArgs,
	result?: string,
): React.ReactElement => {
	return <CheckSkillFormatter args={args} result={result} />;
};

export const checkSkillTool: NanocoderToolExport = {
	name: 'check_skill' as const,
	tool: checkSkillCoreTool,
	formatter: checkSkillFormatter,
	readOnly: true,
};
