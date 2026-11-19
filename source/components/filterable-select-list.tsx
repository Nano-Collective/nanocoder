// source/components/filterable-select-list.tsx
import {Box, Text, useInput} from 'ink';
import {useMemo, useState} from 'react';
import type {ItemSelectorOption} from '@/components/item-selector';
import {useTerminalRows} from '@/hooks/useTerminalWidth';
import {useTheme} from '@/hooks/useTheme';
import {fuzzyScore} from '@/utils/fuzzy-matching';

const DEFAULT_VISIBLE_COUNT = 12;
// Rows around the items that must stay on screen. The list's own: the search
// row, the blank rows around the items and the hint row (4). Every caller
// wraps it in the same padded titled box: title, two borders and top/bottom
// padding (5). The app frame's top and bottom padding (2). Budgeting only the
// list's own four rows let an 18-row terminal push the hint and the box's
// bottom border off screen.
const OVERHEAD_ROWS = 11;

export interface FilterableSelectListProps<TValue extends string = string> {
	items: ItemSelectorOption<TValue>[];
	visibleCount?: number;
	initialSelectedValue?: TValue;
	onSelect: (value: TValue) => void;
	onCancel?: () => void;
}

export function FilterableSelectList<TValue extends string = string>({
	items,
	visibleCount = DEFAULT_VISIBLE_COUNT,
	initialSelectedValue,
	onSelect,
	onCancel,
}: FilterableSelectListProps<TValue>) {
	const {colors} = useTheme();
	// Height-aware clamp: shrink the window so the whole picker still fits.
	// useTerminalRows re-renders on resize; reading stdout.rows directly kept
	// the window it opened with after the terminal was made shorter.
	const terminalRows = useTerminalRows();
	const effectiveVisibleCount = terminalRows
		? Math.max(1, Math.min(visibleCount, terminalRows - OVERHEAD_ROWS))
		: visibleCount;
	const initialIndex = Math.max(
		0,
		items.findIndex(item => item.value === initialSelectedValue),
	);
	const [query, setQuery] = useState('');
	const [highlightedIndex, setHighlightedIndex] = useState(
		initialSelectedValue === undefined ? 0 : Math.max(0, initialIndex),
	);

	const filteredItems = useMemo(() => {
		if (!query) return items;
		return items
			.map(item => ({
				item,
				score: fuzzyScore(item.searchText ?? item.label, query),
			}))
			.filter(entry => entry.score > 0)
			.sort((a, b) => b.score - a.score)
			.map(entry => entry.item);
	}, [items, query]);

	const maxIndex = Math.max(0, filteredItems.length - 1);
	const safeHighlighted = Math.min(highlightedIndex, maxIndex);
	// scroll math mirrors the wizard pattern at
	// source/wizards/steps/model-selection-list.tsx:53-63 (verbatim formula).
	const scrollStart = Math.max(
		0,
		Math.min(
			safeHighlighted - Math.floor(effectiveVisibleCount / 2),
			filteredItems.length - effectiveVisibleCount,
		),
	);
	const visibleItems = filteredItems.slice(
		scrollStart,
		scrollStart + effectiveVisibleCount,
	);

	useInput((input, key) => {
		if (key.escape) {
			onCancel?.();
			return;
		}
		if (key.upArrow) {
			setHighlightedIndex(prev => Math.max(0, prev - 1));
			return;
		}
		if (key.downArrow) {
			setHighlightedIndex(prev => Math.min(maxIndex, prev + 1));
			return;
		}
		if (key.home) {
			setHighlightedIndex(0);
			return;
		}
		if (key.end) {
			setHighlightedIndex(maxIndex);
			return;
		}
		if (key.pageUp) {
			setHighlightedIndex(prev => Math.max(0, prev - effectiveVisibleCount));
			return;
		}
		if (key.pageDown) {
			setHighlightedIndex(prev =>
				Math.min(maxIndex, prev + effectiveVisibleCount),
			);
			return;
		}
		if (key.return) {
			const item = filteredItems[safeHighlighted];
			if (item) onSelect(item.value);
			return;
		}
		if (key.backspace || key.delete) {
			setQuery(prev => prev.slice(0, -1));
			setHighlightedIndex(0);
			return;
		}
		if (
			input &&
			input.length >= 1 &&
			!key.ctrl &&
			!key.meta &&
			!key.upArrow &&
			!key.downArrow &&
			!key.return &&
			!key.escape &&
			!key.backspace &&
			!key.delete
		) {
			setQuery(prev => prev + input);
			setHighlightedIndex(0);
		}
	});

	return (
		<Box flexDirection="column">
			<Box marginBottom={1}>
				<Text color={colors.primary}>
					{query ? (
						<>
							Filter: {query}
							<Text color={colors.secondary}>_</Text>
						</>
					) : (
						<Text color={colors.secondary}>Type to filter…</Text>
					)}
				</Text>
			</Box>
			{visibleItems.length === 0 ? (
				<Text color={colors.secondary}>No matches for "{query}"</Text>
			) : (
				visibleItems.map((item, index) => {
					const actualIndex = scrollStart + index;
					const isHighlighted = actualIndex === safeHighlighted;
					return (
						<Text
							key={item.value}
							color={isHighlighted ? colors.primary : colors.text}
							bold={isHighlighted}
						>
							{isHighlighted ? '❯' : ' '} {item.label}
						</Text>
					);
				})
			)}
		</Box>
	);
}
