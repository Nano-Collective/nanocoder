/**
 * Exit Plan Mode Tool
 *
 * Exits plan mode and presents the plan for user approval.
 * Can trigger an interactive mode selection prompt when no next_mode is provided.
 */

import {Box, Text} from 'ink';

import ToolMessage from '@/components/tool-message';
import {
	getCurrentMode,
	getPlanFilePath,
	getPlanId,
	getPlanPhase,
	resetPlanModeState,
	setCurrentMode,
} from '@/context/mode-context';
import {createPlanManager} from '@/services/plan-manager';
import type {DevelopmentMode, NanocoderToolExport} from '@/types/core';
import {
	DEVELOPMENT_MODE_LABELS,
	jsonSchema,
	PLAN_PHASE_LABELS,
	tool,
} from '@/types/core';
import {triggerModeSelection} from '@/utils/mode-selection-registry';

/**
 * Validate the next mode value
 */
function isValidNextMode(mode: string): mode is DevelopmentMode {
	return mode === 'normal' || mode === 'auto-accept';
}

const executeExitPlanMode = async (args: {
	next_mode?: 'normal' | 'auto-accept';
}): Promise<string> => {
	const currentMode = getCurrentMode();

	// Check if we're actually in plan mode
	if (currentMode !== 'plan') {
		const currentLabel =
			DEVELOPMENT_MODE_LABELS[
				currentMode as keyof typeof DEVELOPMENT_MODE_LABELS
			];
		throw new Error(
			`Cannot exit plan mode from ${currentLabel}. Plan mode is not currently active.`,
		);
	}

	const planId = getPlanId();
	const planPhase = getPlanPhase();
	const planFilePath = getPlanFilePath();

	if (!planId || !planFilePath) {
		throw new Error('Plan mode state is corrupted. No active plan found.');
	}

	try {
		// Read the plan file to display to user
		const cwd = process.cwd();
		const planManager = createPlanManager(cwd);
		const {content, exists} = await planManager.readPlan(planId);

		if (!exists) {
			throw new Error(`Plan file not found: ${planFilePath}`);
		}

		// Check if next_mode was explicitly provided
		const nextModeExplicitlyProvided = args.next_mode !== undefined;

		// If next_mode was not provided, trigger mode selection prompt
		if (!nextModeExplicitlyProvided) {
			// Try to trigger interactive mode selection
			const modeSelectionTriggered = await new Promise<boolean>(resolve => {
				const triggered = triggerModeSelection(
					(selectedMode: DevelopmentMode) => {
						// User selected a mode - switch to it
						setCurrentMode(selectedMode);
						resetPlanModeState();
						resolve(true);
					},
					() => {
						// User cancelled - default to normal mode
						setCurrentMode('normal');
						resetPlanModeState();
						resolve(true);
					},
				);

				// If no callback registered, resolve immediately
				if (!triggered) {
					resolve(false);
				}
			});

			// If mode selection was triggered, return immediately
			// The mode has already been switched by the callback
			if (modeSelectionTriggered) {
				const phaseLabel = PLAN_PHASE_LABELS[planPhase];

				let output = `✓ Plan Complete\n\n`;
				output += `Plan ID: ${planId}\n`;
				output += `Final Phase: ${phaseLabel}\n`;
				output += `Plan File: ${planFilePath}\n\n`;
				output += `The plan has been saved to: ${planFilePath}\n`;

				return output;
			}

			// No callback registered - fall through to default behavior
		}

		// Determine next mode (either explicitly provided or default)
		const nextMode: DevelopmentMode = args.next_mode || 'normal';
		if (!isValidNextMode(nextMode)) {
			throw new Error(
				`Invalid next_mode: "${args.next_mode}". Must be "normal" or "auto-accept".`,
			);
		}

		// Update mode context
		setCurrentMode(nextMode);
		resetPlanModeState();

		// Format the output
		const phaseLabel = PLAN_PHASE_LABELS[planPhase];
		const nextModeLabel = DEVELOPMENT_MODE_LABELS[nextMode];

		let output = `✓ Exited Plan Mode\n\n`;
		output += `Plan ID: ${planId}\n`;
		output += `Final Phase: ${phaseLabel}\n`;
		output += `Plan File: ${planFilePath}\n`;
		output += `Next Mode: ${nextModeLabel}\n\n`;
		output += `--- PLAN CONTENT ---\n\n`;
		output += content;
		output += `\n--- END OF PLAN ---\n\n`;
		output += `The plan has been saved to: ${planFilePath}\n`;
		output += `You can now proceed with implementation in ${nextModeLabel}.\n`;

		return output;
	} catch (error) {
		const errorMessage = error instanceof Error ? error.message : String(error);
		throw new Error(`Failed to exit plan mode: ${errorMessage}`);
	}
};

const exitPlanModeCoreTool = tool({
	description:
		'Exit Plan Mode and present the completed plan for user approval. Displays the full plan content and transitions to the selected mode (normal or auto-accept) for implementation. The plan file is preserved for reference during implementation.',
	inputSchema: jsonSchema<{
		next_mode?: 'normal' | 'auto-accept';
	}>({
		type: 'object',
		properties: {
			next_mode: {
				type: 'string',
				enum: ['normal', 'auto-accept'],
				description:
					'Optional: The mode to enter after exiting plan mode. Defaults to "normal". Use "auto-accept" to proceed directly to implementation without tool confirmations.',
			},
		},
	}),
	needsApproval: false, // Always allow - mode change is user-controlled
	execute: async (
		args: {next_mode?: 'normal' | 'auto-accept'},
		_options: {toolCallId: string; messages: unknown[]},
	) => {
		return await executeExitPlanMode(args);
	},
});

const ExitPlanModeFormatter = ({
	args,
	result,
}: {
	args: {next_mode?: 'normal' | 'auto-accept'};
	result?: string;
}): React.ReactElement => {
	const nextMode = args.next_mode || 'normal';
	const nextModeLabel = DEVELOPMENT_MODE_LABELS[nextMode];

	const messageContent = (
		<Box flexDirection="column">
			<Text color="#00ff00">▶ Exiting Plan Mode...</Text>
			<Text dimColor>(Transitioning to {nextModeLabel})</Text>
			{result && (
				<Box marginTop={1} flexDirection="column">
					<Text>{result}</Text>
				</Box>
			)}
		</Box>
	);

	return <ToolMessage message={messageContent} hideBox={true} />;
};

const exitPlanModeValidator = async (args: {
	next_mode?: 'normal' | 'auto-accept';
}): Promise<{valid: true} | {valid: false; error: string}> => {
	const currentMode = getCurrentMode();

	// Check if we're in plan mode
	if (currentMode !== 'plan') {
		const currentLabel =
			DEVELOPMENT_MODE_LABELS[
				currentMode as keyof typeof DEVELOPMENT_MODE_LABELS
			];
		return {
			valid: false,
			error: `▶ Cannot exit plan mode from ${currentLabel}. Plan mode is not currently active.`,
		};
	}

	// Validate next_mode if provided
	if (args.next_mode && !isValidNextMode(args.next_mode)) {
		return {
			valid: false,
			error: `Invalid next_mode: "${args.next_mode}". Must be "normal" or "auto-accept".`,
		};
	}

	return {valid: true};
};

export const exitPlanModeTool: NanocoderToolExport = {
	name: 'exit-plan-mode' as const,
	tool: exitPlanModeCoreTool,
	formatter: ExitPlanModeFormatter,
	validator: exitPlanModeValidator,
};
