import {Box, Text, useInput} from 'ink';
import SelectInput from 'ink-select-input';
import {FilterableSelectList} from '@/components/filterable-select-list';
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
	searchable?: boolean;
	visibleCount?: number;
	initialSelectedValue?: TValue;
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
	searchable = false,
	visibleCount,
	initialSelectedValue,
}: ItemSelectorProps<TValue>) {
	const boxWidth = useTerminalWidth();
	const {colors} = useTheme();

	// Single owner for Escape during loading/error branches, where
	// FilterableSelectList is not mounted. Dormant during the normal
	// searchable path (isActive=false) so it can't double-fire with the
	// child's own Escape handler (Ink useInput is broadcast).
	useInput(
		(_, key) => {
			if (key.escape) {
				onCancel();
			}
		},
		{isActive: !searchable || loading || error != null},
	);

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
				{searchable ? (
					<FilterableSelectList
						items={items}
						visibleCount={visibleCount}
						initialSelectedValue={initialSelectedValue}
						onSelect={value => onSelect(value as TValue)}
						onCancel={onCancel}
					/>
				) : (
					<SelectInput
						items={items}
						onSelect={item => onSelect(item.value as TValue)}
					/>
				)}
				<Box marginTop={1}>
					<Text color={colors.secondary}>
						{searchable
							? 'Type to filter · ↑↓ navigate · Enter select · Esc cancel'
							: 'Press Escape to cancel'}
					</Text>
				</Box>
			</Box>
		</TitledBoxWithPreferences>
	);
}
