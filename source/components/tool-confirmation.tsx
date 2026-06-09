import {Box, Text, useInput} from 'ink';
import SelectInput from 'ink-select-input';
import React from 'react';
import {RenderErrorBoundary} from '@/components/render-error-boundary';
import {useTerminalWidth} from '@/hooks/useTerminalWidth';
import {useTheme} from '@/hooks/useTheme';
import {getToolManager} from '@/message-handler';
import type {ToolCall} from '@/types/core';
import {formatError} from '@/utils/error-formatter';
import {getLogger} from '@/utils/logging';
import {
	getToolJsonSchema,
	validateArgsAgainstSchema,
} from '@/utils/schema-validate';
import {parseToolArguments} from '@/utils/tool-args-parser';
import {formatValidationError} from '@/utils/tool-validation';

interface ToolConfirmationProps {
	toolCall: ToolCall;
	onConfirm: (confirmed: boolean) => void;
	onCancel: () => void;
}

interface ConfirmationOption {
	label: string;
	value: boolean;
}

export default function ToolConfirmation({
	toolCall,
	onConfirm,
	onCancel,
}: ToolConfirmationProps) {
	const boxWidth = useTerminalWidth();
	const {colors} = useTheme();
	const [formatterPreview, setFormatterPreview] = React.useState<
		React.ReactElement | string | null
	>(null);
	const [isLoadingPreview, setIsLoadingPreview] = React.useState(false);
	const [hasFormatterError, setHasFormatterError] = React.useState(false);
	const [hasValidationError, setHasValidationError] = React.useState(false);
	const [_validationError, setValidationError] = React.useState<string | null>(
		null,
	);

	// Get MCP tool info for display
	const toolManager = getToolManager();
	const mcpInfo = toolManager?.getMCPToolInfo(toolCall.function.name) || {
		isMCPTool: false,
	};

	// Load formatter preview
	React.useEffect(() => {
		const loadPreview = async () => {
			if (!toolManager) return;

			let parsedArgs: Record<string, unknown> = {};
			try {
				parsedArgs = parseToolArguments(toolCall.function.arguments);
			} catch {
				// Leave as {} — the schema/validator will surface the real problem.
			}

			// 1. Schema type-check — the same check the executed handler runs, so a
			// wrong-typed argument shows red here and is fed back to the model.
			const schema = getToolJsonSchema(
				toolManager.getToolEntry(toolCall.function.name)?.tool,
			);
			const typeErrors = schema
				? validateArgsAgainstSchema(parsedArgs, schema)
				: [];
			if (typeErrors.length > 0) {
				const msg = formatValidationError(
					'one or more arguments have the wrong type — fix the types and call the tool again',
					typeErrors,
				);
				setValidationError(msg);
				setHasValidationError(true);
				setFormatterPreview(<Text color={colors.error}>{msg}</Text>);
				return;
			}

			// 2. Per-tool validator.
			const validator = toolManager.getToolValidator(toolCall.function.name);
			if (validator) {
				try {
					const validationResult = await validator(parsedArgs);
					if (!validationResult.valid) {
						setValidationError(validationResult.error);
						setHasValidationError(true);
						setFormatterPreview(
							<Text color={colors.error}>{validationResult.error}</Text>,
						);
						return;
					}
				} catch (error) {
					const logger = getLogger();
					logger.error({error: formatError(error)}, 'Error running validator');
					const errorMsg = `Validation error: ${formatError(error)}`;
					setValidationError(errorMsg);
					setHasValidationError(true);
					setFormatterPreview(<Text color={colors.error}>{errorMsg}</Text>);
					return;
				}
			}

			// 3. Formatter preview.
			const formatter = toolManager.getToolFormatter(toolCall.function.name);
			if (formatter) {
				setIsLoadingPreview(true);
				try {
					const preview = await formatter(parsedArgs);
					setFormatterPreview(preview);
				} catch (error) {
					const logger = getLogger();
					logger.error(
						{error: formatError(error)},
						'Error loading formatter preview',
					);
					setHasFormatterError(true);
					setFormatterPreview(
						<Text color={colors.error}>Error: {String(error)}</Text>,
					);
				} finally {
					setIsLoadingPreview(false);
				}
			}
		};

		void loadPreview();
	}, [toolCall, toolManager, colors.error]);

	// Handle escape key to cancel
	useInput((_inputChar, key) => {
		if (key.escape) {
			onCancel();
		}
	});

	// Auto-handle errors without user interaction
	React.useEffect(() => {
		if (hasFormatterError && !hasValidationError) {
			// Automatically cancel the tool execution only for formatter crashes
			onConfirm(false);
		}
		if (hasValidationError) {
			// Automatically proceed to execution phase where the validator
			// will fail again and pass the error back to the model to correct
			onConfirm(true);
		}
	}, [hasFormatterError, hasValidationError, onConfirm]);

	const options: ConfirmationOption[] = [
		{label: '✓ Yes, execute this tool', value: true},
		{label: '✗ No, cancel execution', value: false},
	];

	const handleSelect = (item: ConfirmationOption) => {
		onConfirm(item.value);
	};

	return (
		<Box width={boxWidth} marginBottom={1}>
			<Box flexDirection="column">
				{/* Formatter preview */}
				{isLoadingPreview && (
					<Box marginBottom={1}>
						<Text color={colors.secondary}>Loading preview...</Text>
					</Box>
				)}

				{formatterPreview && !isLoadingPreview && (
					<Box marginBottom={1} flexDirection="column">
						<Box>
							{React.isValidElement(formatterPreview) ? (
								<RenderErrorBoundary label={toolCall.function.name}>
									{formatterPreview}
								</RenderErrorBoundary>
							) : (
								<Text color={colors.text}>{String(formatterPreview)}</Text>
							)}
						</Box>
					</Box>
				)}

				{/* Only show approval prompt if there's no error */}
				{!hasFormatterError && !hasValidationError && (
					<>
						<Box marginBottom={1}>
							<Text color={colors.tool}>
								{`Do you want to execute ${
									mcpInfo.isMCPTool
										? `MCP tool "${toolCall.function.name}" from server "${mcpInfo.serverName}"`
										: `tool "${toolCall.function.name}"`
								}?`}
							</Text>
						</Box>

						<SelectInput items={options} onSelect={handleSelect} />

						<Box marginTop={1}>
							<Text color={colors.secondary}>Press Escape to cancel</Text>
						</Box>
					</>
				)}

				{/* Show automatic cancellation message for formatter crashes only */}
				{hasFormatterError && !hasValidationError && (
					<Box marginTop={1}>
						<Text color={colors.error}>
							Tool execution cancelled due to formatter error.
						</Text>
						<Text color={colors.secondary}>Press Escape to continue</Text>
					</Box>
				)}
			</Box>
		</Box>
	);
}
