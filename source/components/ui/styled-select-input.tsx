import {Box, Text} from 'ink';
import SelectInput from 'ink-select-input';
import type {ComponentProps, ReactElement} from 'react';

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
 * `isFocused`, `limit`) forward through unchanged. Rows that need more than a
 * plain label (a description column, say) can pass their own `itemComponent`
 * and still get the themed indicator.
 *
 * Prefer this over `SelectInput` everywhere: the library's default indicator
 * and selected-label colour are a hardcoded `blue` that all but disappears
 * against a dark terminal background.
 */
interface StyledSelectInputProps<V, I extends Item<V> = Item<V>> {
	items?: Array<I>;
	isFocused?: boolean;
	initialIndex?: number;
	limit?: number;
	onSelect?: (item: I) => void;
	onHighlight?: (item: I) => void;
	itemComponent?: (props: I & {isSelected?: boolean}) => ReactElement;
}

export function StyledSelectInput<V, I extends Item<V> = Item<V>>(
	props: StyledSelectInputProps<V, I>,
) {
	const {colors} = useTheme();

	const itemComponent =
		props.itemComponent ??
		(({isSelected, label}) => (
			<Text
				color={isSelected ? colors.primary : colors.text}
				wrap="truncate-end"
			>
				{label}
			</Text>
		));

	// ink-select-input's runtime spreads the whole item into these; its own
	// types just don't say so.
	return (
		<SelectInput
			{...(props as unknown as ComponentProps<typeof SelectInput>)}
			// Fixed-width indicator: Ink trims a trailing space only on rows that
			// overflow, which left truncated rows a column left of short ones.
			indicatorComponent={({isSelected}) => (
				<Box minWidth={2}>
					<Text color={isSelected ? colors.primary : colors.text}>
						{isSelected ? '>' : ' '}
					</Text>
				</Box>
			)}
			// Truncate rather than wrap: a long label (a path, a URL) reflowed with
			// no hanging indent and the list read as a jumble on narrow terminals.
			itemComponent={
				itemComponent as unknown as ComponentProps<
					typeof SelectInput
				>['itemComponent']
			}
		/>
	);
}
