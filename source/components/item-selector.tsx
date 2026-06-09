import {Box, Text, useInput} from 'ink';
import SelectInput from 'ink-select-input';
import {TitledBoxWithPreferences} from '@/components/ui/titled-box';
import {useTerminalWidth} from '@/hooks/useTerminalWidth';
import {useTheme} from '@/hooks/useTheme';

export interface ItemSelectorOption<TValue extends string = string> {
	label: string;
	value: TValue;
}

interface ItemSelectorProps<TValue extends string = string> {
	title: string;
	items: ItemSelectorOption<TValue>[];
	onSelect: (value: TValue) => void;
	onCancel: () => void;
	loading?: boolean;
	loadingMessage?: string;
	error?: string | null;
	errorTitle?: string;
	errorHint?: string;
}

/**
 * Shared layout for selectors built on `TitledBoxWithPreferences` +
 * `SelectInput` + escape-to-cancel + loading/error states. Used by
 * `model-selector`. Selectors with bespoke layout
 * (e.g. session-selector, checkpoint-selector, ide-selector) do not use this
 * because they extend the pattern with additional state machines or layouts
 * that don't fit a generic shape.
 */
export function ItemSelector<TValue extends string = string>({
	title,
	items,
	onSelect,
	onCancel,
	loading,
	loadingMessage = 'Loading…',
	error,
	errorTitle,
	errorHint,
}: ItemSelectorProps<TValue>) {
	const boxWidth = useTerminalWidth();
	const {colors} = useTheme();

	useInput((_, key) => {
		if (key.escape) {
			onCancel();
		}
	});

	if (loading) {
		return (
			<TitledBoxWithPreferences
				title={title}
				width={boxWidth}
				borderColor={colors.primary}
				paddingX={2}
				paddingY={1}
				marginBottom={1}
			>
				<Text color={colors.secondary}>{loadingMessage}</Text>
			</TitledBoxWithPreferences>
		);
	}

	if (error) {
		return (
			<TitledBoxWithPreferences
				title={errorTitle ?? `${title} - Error`}
				width={boxWidth}
				borderColor={colors.error}
				paddingX={2}
				paddingY={1}
				marginBottom={1}
			>
				<Box flexDirection="column">
					<Text color={colors.error}>{error}</Text>
					{errorHint && <Text color={colors.secondary}>{errorHint}</Text>}
					<Box marginTop={1}>
						<Text color={colors.secondary}>Press Escape to cancel</Text>
					</Box>
				</Box>
			</TitledBoxWithPreferences>
		);
	}

	return (
		<TitledBoxWithPreferences
			title={title}
			width={boxWidth}
			borderColor={colors.primary}
			paddingX={2}
			paddingY={1}
			marginBottom={1}
		>
			<Box flexDirection="column">
				<SelectInput
					items={items}
					onSelect={item => onSelect(item.value as TValue)}
				/>
				<Box marginTop={1}>
					<Text color={colors.secondary}>Press Escape to cancel</Text>
				</Box>
			</Box>
		</TitledBoxWithPreferences>
	);
}
