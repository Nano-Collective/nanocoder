/**
 * Enter Plan Mode Tool
 *
 * Creates a new plan file and enters plan mode for structured planning.
 */

import {Box, Text} from 'ink';

import ToolMessage from '@/components/tool-message';
import {
	getCurrentMode,
	setCurrentMode,
	setPlanDirectoryPath,
	setPlanFilePath,
	setPlanPhase,
	setPlanSummary,
	setProposalPath,
} from '@/context/mode-context';
import {createPlanManager} from '@/services/plan-manager';
import type {NanocoderToolExport} from '@/types/core';
import {DEVELOPMENT_MODE_LABELS, jsonSchema, tool} from '@/types/core';
import {getLogger} from '@/utils/logging';

/**
 * Check if plan mode can be entered from current mode
 */
function canEnterPlanMode(currentMode: string): boolean {
	return currentMode === 'normal' || currentMode === 'auto-accept';
}

const executeEnterPlanMode = async (args: {
	skip_directory_validation?: boolean;
}): Promise<string> => {
	const logger = getLogger();
	const currentMode = getCurrentMode();

	// Check if we can enter plan mode from current state
	if (!canEnterPlanMode(currentMode)) {
		const currentLabel =
			DEVELOPMENT_MODE_LABELS[
				currentMode as keyof typeof DEVELOPMENT_MODE_LABELS
			];
		throw new Error(
			`Cannot enter plan mode from ${currentLabel}. Plan mode can only be entered from normal or auto-accept mode.`,
		);
	}

	try {
		// Create plan manager for current working directory
		const cwd = process.cwd();
		const planManager = createPlanManager(cwd);

		// Validate directory if not skipped
		if (!args.skip_directory_validation) {
			const validationResult = await planManager.validateDirectory();
			if (!validationResult.valid) {
				throw new Error(
					`Directory validation failed: ${validationResult.reason}. To skip validation, set skip_directory_validation=true.`,
				);
			}
		}

		// Create new plan
		const {planSummary, planDirectoryPath, proposalPath, planFilePath} =
			await planManager.createPlan();

		// Update mode context
		setCurrentMode('plan');
		setPlanSummary(planSummary);
		setPlanPhase('understanding');
		setPlanDirectoryPath(planDirectoryPath);
		setProposalPath(proposalPath);
		setPlanFilePath(planFilePath);

		logger.info(`Entered plan mode with plan: ${planSummary}`);

		let output = `✓ Entered Plan Mode\n\n`;
		output += `Plan: ${planSummary}\n`;
		output += `Directory: ${planDirectoryPath}\n`;
		output += `Phase: Understanding\n\n`;
		output += `You are now in Plan Mode. Use read-only tools to explore the codebase `;
		output += `and write your findings to the plan documents. Follow the 5-phase workflow:\n`;
		output += `1. Understanding - Gather requirements\n`;
		output += `2. Design - Explore approaches\n`;
		output += `3. Review - Present plan for feedback\n`;
		output += `4. Final Plan - Create task list\n`;
		output += `5. Exit - Complete and present for approval\n`;

		return output;
	} catch (error) {
		const errorMessage = error instanceof Error ? error.message : String(error);
		throw new Error(`Failed to enter plan mode: ${errorMessage}`);
	}
};

const enterPlanModeCoreTool = tool({
	description:
		'Enter Plan Mode for structured planning. Creates a new plan file with unique ID and enables the 5-phase workflow (Understanding → Design → Review → Final Plan → Exit). In plan mode, you can use read-only tools freely and write to the plan file, but other write operations and bash commands are blocked. Use skip_directory_validation=true to bypass directory checks.',
	inputSchema: jsonSchema<{
		skip_directory_validation?: boolean;
	}>({
		type: 'object',
		properties: {
			skip_directory_validation: {
				type: 'boolean',
				description:
					'Optional: Skip directory validation checks. Set to true to enter plan mode even if directory is not writable. Use with caution.',
			},
		},
	}),
	needsApproval: false, // Always allow - mode change is user-controlled
	execute: async (
		args: {skip_directory_validation?: boolean},
		_options: {toolCallId: string; messages: unknown[]},
	) => {
		return await executeEnterPlanMode(args);
	},
});

const EnterPlanModeFormatter = ({
	args,
	result,
}: {
	args: {skip_directory_validation?: boolean};
	result?: string;
}): React.ReactElement => {
	const messageContent = (
		<Box flexDirection="column">
			<Text color="#00ff00">⏸ Entering Plan Mode...</Text>
			{args.skip_directory_validation && (
				<Text dimColor>(Skipping directory validation)</Text>
			)}
			{result && (
				<Box marginTop={1} flexDirection="column">
					<Text>{result}</Text>
				</Box>
			)}
		</Box>
	);

	return <ToolMessage message={messageContent} hideBox={true} />;
};

const enterPlanModeValidator = async (_args: {
	skip_directory_validation?: boolean;
}): Promise<{valid: true} | {valid: false; error: string}> => {
	const currentMode = getCurrentMode();

	// Check if we can enter plan mode from current state
	if (!canEnterPlanMode(currentMode)) {
		const currentLabel =
			DEVELOPMENT_MODE_LABELS[
				currentMode as keyof typeof DEVELOPMENT_MODE_LABELS
			];
		return {
			valid: false,
			error: `⏸ Cannot enter plan mode from ${currentLabel}. Plan mode can only be entered from normal or auto-accept mode.`,
		};
	}

	return {valid: true};
};

export const enterPlanModeTool: NanocoderToolExport = {
	name: 'enter-plan-mode' as const,
	tool: enterPlanModeCoreTool,
	formatter: EnterPlanModeFormatter,
	validator: enterPlanModeValidator,
};
