import {Box, Text} from 'ink';
import React from 'react';
import ToolMessage from '@/components/tool-message';
import {useTheme} from '@/hooks/useTheme';
import {bashExecutor} from '@/services/bash-executor';
import {formatBackgroundOutput} from '@/tools/bash-jobs';
import type {NanocoderToolExport} from '@/types/core';
import {jsonSchema, tool} from '@/types/core';

interface BashOutputArgs {
	job_id: string;
}

const executeBashOutput = async (args: BashOutputArgs): Promise<string> => {
	const jobId = (args.job_id ?? '').trim();
	if (!jobId) {
		throw new Error(
			'bash_output requires a "job_id" (the JOB_ID returned by execute_bash with run_in_background).',
		);
	}

	const job = bashExecutor.readJobOutput(jobId);
	if (!job) {
		throw new Error(
			`No background job with id "${jobId}". It may have been dropped after the retained-job limit, or the id is wrong.`,
		);
	}

	return formatBackgroundOutput(job);
};

const bashOutputCoreTool = tool({
	description:
		'Read the output a background job (started with execute_bash run_in_background) has produced since the previous read. Returns only the new stdout/stderr plus whether the job is still running or how it exited. Use the job_id from the execute_bash result.',
	inputSchema: jsonSchema<BashOutputArgs>({
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
		return await executeBashOutput(args);
	},
});

interface BashOutputFormatterProps {
	args: BashOutputArgs;
	result?: string;
}

const BashOutputFormatter = React.memo(
	({args, result}: BashOutputFormatterProps) => {
		const {colors} = useTheme();

		const messageContent = (
			<Box flexDirection="column">
				<Text color={colors.tool}>⚒ bash_output</Text>
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

const bashOutputFormatter = (
	args: BashOutputArgs,
	result?: string,
): React.ReactElement => {
	return <BashOutputFormatter args={args} result={result} />;
};

const bashOutputValidator = (
	args: BashOutputArgs,
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

export const bashOutputTool: NanocoderToolExport = {
	name: 'bash_output' as const,
	tool: bashOutputCoreTool,
	formatter: bashOutputFormatter,
	validator: bashOutputValidator,
	// Reading job output has no side effects.
	readOnly: true,
};
