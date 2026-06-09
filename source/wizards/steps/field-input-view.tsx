import {Box, Text} from 'ink';
import SelectInput from 'ink-select-input';
import TextInput from '@/components/text-input';
import type {TemplateField} from '../templates/provider-templates';

export interface FieldInputViewProps {
	templateName: string;
	currentField: TemplateField;
	fieldIndex: number;
	fieldCount: number;
	currentValue: string;
	error: string | null;
	isNarrow: boolean;
	// `inputKey` remounts the TextInput when the parent wants to reset cursor
	// state (e.g. when navigating back to a previous field). Has no effect on
	// SelectInput, which is its own widget.
	inputKey: number;
	colors: {
		primary: string;
		secondary: string;
		error: string;
	};
	onChange: (value: string) => void;
	// `overrideValue` lets the boolean SelectInput submit synchronously
	// without waiting for the async setState round-trip that would lose the
	// chosen value to the global Enter handler.
	onSubmit: (overrideValue?: string) => void;
}

/**
 * Renders a single field within the provider wizard's field-input mode.
 *
 * The widget chosen depends on `currentField.type`:
 *   - 'boolean': Yes / No / Skip select with the previous answer highlighted.
 *   - 'array' or 'string' (default): TextInput; the prompt itself signals
 *     that array fields accept a comma-separated list.
 *   - 'sensitive' fields render a masked TextInput regardless of type.
 *
 * Extracted from ProviderStep so the rendering branches can be unit-tested
 * without driving the entire wizard state machine.
 */
export function FieldInputView({
	templateName,
	currentField,
	fieldIndex,
	fieldCount,
	currentValue,
	error,
	isNarrow,
	inputKey,
	colors,
	onChange,
	onSubmit,
}: FieldInputViewProps) {
	const isBoolean = currentField.type === 'boolean';

	return (
		<Box flexDirection="column">
			<Box marginBottom={1}>
				<Text bold color={colors.primary}>
					{templateName} Configuration
				</Text>
				<Text>
					{' '}
					(Field {fieldIndex + 1}/{fieldCount})
				</Text>
			</Box>

			<Box>
				<Text>
					{currentField.prompt}
					{currentField.required && <Text color={colors.error}> *</Text>}:{' '}
					{currentField.sensitive && '****'}
				</Text>
			</Box>

			{isBoolean && (
				<Box marginBottom={1}>
					<SelectInput
						items={[
							{label: 'Yes', value: 'true'},
							{label: 'No', value: 'false'},
							{label: 'Skip (use OpenRouter default)', value: ''},
						]}
						initialIndex={
							currentValue === 'true' ? 0 : currentValue === 'false' ? 1 : 2
						}
						onSelect={item => onSubmit(item.value)}
					/>
				</Box>
			)}

			{!isBoolean && !currentField.sensitive && (
				<Box
					marginBottom={1}
					borderStyle="round"
					borderColor={colors.secondary}
				>
					<TextInput
						key={inputKey}
						value={currentValue}
						onChange={onChange}
						onSubmit={() => onSubmit()}
					/>
				</Box>
			)}

			{!isBoolean && currentField.sensitive && (
				<Box
					marginBottom={1}
					borderStyle="round"
					borderColor={colors.secondary}
				>
					<TextInput
						key={inputKey}
						value={currentValue}
						onChange={onChange}
						onSubmit={() => onSubmit()}
						mask="*"
					/>
				</Box>
			)}

			{error && (
				<Box marginBottom={1}>
					<Text color={colors.error}>{error}</Text>
				</Box>
			)}

			{isNarrow ? (
				<Box flexDirection="column">
					<Text color={colors.secondary}>Enter: continue</Text>
					<Text color={colors.secondary}>Shift+Tab: go back</Text>
				</Box>
			) : (
				<Box>
					<Text color={colors.secondary}>
						Press Enter to continue | Shift+Tab to go back
					</Text>
				</Box>
			)}
		</Box>
	);
}
