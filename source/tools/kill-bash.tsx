import {Box, Text} from 'ink';
import React from 'react';
import ToolMessage from '@/components/tool-message';
import {useTheme} from '@/hooks/useTheme';
import {bashExecutor} from '@/services/bash-executor';
import {formatKillResult} from '@/tools/bash-jobs';
import type {NanocoderToolExport} from '@/types/core';
import {jsonSchema, tool} from '@/types/core';

interface KillBashArgs {
	job_id: string;
}

const executeKillBash = async (args: KillBashArgs): Promise<string> => {
	const jobId = (args.job_id ?? '').trim();
	if (!jobId) {
		throw new Error(
			'kill_bash requires a "job_id" (the JOB_ID returned by execute_bash with run_in_background).',
		);
	}

	const job = await bashExecutor.killJob(jobId);
	if (!job) {
		throw new Error(
			`No background job with id "${jobId}". It may have been dropped after the retained-job limit, or the id is wrong.`,
		);
	}

	return formatKillResult(job);
};

const killBashCoreTool = tool({
	description:
		'Stop a background job started with execute_bash run_in_background. Kills the process group and waits for it to exit, so nothing is left behind. Use bash_output first if you want to read any final output.',
	inputSchema: jsonSchema<KillBashArgs>({
		type: 'object',
		properties: {
			job_id: {
				type: 'string',
				description: 'The JOB_ID returned when the background job was started.',
			},
		},
		required: ['job_id'],
	}),
	execute: async (args, _options) => {
		return await executeKillBash(args);
	},
});

interface KillBashFormatterProps {
	args: KillBashArgs;
	result?: string;
}

const KillBashFormatter = React.memo(
	({args, result}: KillBashFormatterProps) => {
		const {colors} = useTheme();

		const messageContent = (
			<Box flexDirection="column">
				<Text color={colors.tool}>⚒ kill_bash</Text>
				<Box>
					<Text color={colors.secondary}>Job: </Text>
					<Text color={colors.text}>{args.job_id}</Text>
				</Box>
				{result && (
					<Box marginTop={1} flexDirection="column">
						<Text color={colors.text}>{result}</Text>
					</Box>
				)}
			</Box>
		);

		return <ToolMessage message={messageContent} hideBox={true} />;
	},
);

const killBashFormatter = (
	args: KillBashArgs,
	result?: string,
): React.ReactElement => {
	return <KillBashFormatter args={args} result={result} />;
};

const killBashValidator = (
	args: KillBashArgs,
): Promise<{valid: true} | {valid: false; error: string}> => {
	const jobId = args.job_id?.trim();
	if (!jobId) {
		return Promise.resolve({
			valid: false,
			error: 'job_id cannot be empty',
		});
	}
	return Promise.resolve({valid: true});
};

export const killBashTool: NanocoderToolExport = {
	name: 'kill_bash' as const,
	tool: killBashCoreTool,
	formatter: killBashFormatter,
	validator: killBashValidator,
	// Killing a job the agent started is low risk: the job is already a
	// background process the agent owns, and the user approved its start.
	approval: false,
};
