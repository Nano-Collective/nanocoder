import {Text} from 'ink';
import SelectInput from 'ink-select-input';

import {useTheme} from '@/hooks/useTheme';

/** Mirrors ink-select-input's internal `Item<V>` (not exported from the root). */
interface Item<V> {
	key?: string;
	label: string;
	value: V;
}

/**
 * `ink-select-input` with nanocoder's standard `> ` indicator and themed
 * label colouring baked in. Every selector in the app rendered the same
 * `indicatorComponent` / `itemComponent` pair by hand; this wraps that once.
 *
 * All other SelectInput props (`onSelect`, `onHighlight`, `initialIndex`,
 * `isFocused`, `limit`) forward through unchanged. SelectInputs that rely on
 * the library's default indicator should keep using `SelectInput` directly.
 */
interface StyledSelectInputProps<V> {
	items?: Array<Item<V>>;
	isFocused?: boolean;
	initialIndex?: number;
	limit?: number;
	onSelect?: (item: Item<V>) => void;
	onHighlight?: (item: Item<V>) => void;
}

export function StyledSelectInput<V>(props: StyledSelectInputProps<V>) {
	const {colors} = useTheme();

	return (
		<SelectInput
			{...props}
			indicatorComponent={({isSelected}) => (
				<Text color={isSelected ? colors.primary : colors.text}>
					{isSelected ? '> ' : '  '}
				</Text>
			)}
			itemComponent={({isSelected, label}) => (
				<Text color={isSelected ? colors.primary : colors.text}>{label}</Text>
			)}
		/>
	);
}
