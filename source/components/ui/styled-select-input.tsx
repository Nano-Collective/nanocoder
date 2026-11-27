import {isDeepStrictEqual} from 'node:util';
import {Box, Text, useInput} from 'ink';
import {
	type ReactElement,
	useCallback,
	useEffect,
	useRef,
	useState,
} from 'react';

import {useTheme} from '@/hooks/useTheme';

interface Item<V> {
	key?: string;
	label: string;
	value: V;
}

interface StyledSelectInputProps<V, I extends Item<V> = Item<V>> {
	items?: Array<I>;
	isFocused?: boolean;
	initialIndex?: number;
	limit?: number;
	onSelect?: (item: I) => void;
	onHighlight?: (item: I) => void;
	itemComponent?: (props: I & {isSelected?: boolean}) => ReactElement;
}

function rotateArray<T>(array: readonly T[], steps: number): T[] {
	const {length} = array;
	if (length === 0) return [];
	const normalizedSteps = ((steps % length) + length) % length;
	if (normalizedSteps === 0) return [...array];
	return [
		...array.slice(-normalizedSteps),
		...array.slice(0, -normalizedSteps),
	];
}

/**
 * Themed single-choice selector with nanocoder's standard `> ` indicator and
 * themed label colouring.
 *
 * Keeps the highlighted/scroll indices in refs updated synchronously inside
 * `useInput` so multiple keys delivered in a single stdin chunk (e.g. Down +
 * Enter over SSH, tmux, macros, or fast typing) cannot select the stale
 * pre-navigation item.
 */
export function StyledSelectInput<V, I extends Item<V> = Item<V>>({
	items = [],
	isFocused = true,
	initialIndex = 0,
	limit: customLimit,
	onSelect,
	onHighlight,
	itemComponent: CustomItem,
}: StyledSelectInputProps<V, I>) {
	const {colors} = useTheme();

	const hasLimit =
		typeof customLimit === 'number' && items.length > customLimit;
	const limit = hasLimit ? Math.min(customLimit, items.length) : items.length;
	const lastIndex = Math.max(0, limit - 1);

	const clampedInitial =
		items.length > 0
			? Math.max(0, Math.min(initialIndex, items.length - 1))
			: 0;
	const initialRotateIndex =
		hasLimit && clampedInitial > lastIndex ? lastIndex - clampedInitial : 0;
	const initialSelectedIndex =
		hasLimit && clampedInitial > lastIndex ? lastIndex : clampedInitial;

	const [rotateIndex, setRotateIndex] = useState(initialRotateIndex);
	const [selectedIndex, setSelectedIndex] = useState(initialSelectedIndex);
	const rotateIndexRef = useRef(initialRotateIndex);
	const selectedIndexRef = useRef(initialSelectedIndex);
	const previousItemsRef = useRef(items);

	useEffect(() => {
		if (
			!isDeepStrictEqual(
				previousItemsRef.current.map(item => item.value),
				items.map(item => item.value),
			)
		) {
			rotateIndexRef.current = 0;
			selectedIndexRef.current = 0;
			setRotateIndex(0);
			setSelectedIndex(0);
		}
		previousItemsRef.current = items;
	}, [items]);

	const getVisibleItems = useCallback(
		(currentRotateIndex: number) =>
			hasLimit ? rotateArray(items, currentRotateIndex).slice(0, limit) : items,
		[hasLimit, items, limit],
	);

	useInput(
		(input, key) => {
			if (items.length === 0) return;

			if (input === 'k' || key.upArrow) {
				const currentSelected = Math.min(selectedIndexRef.current, lastIndex);
				const currentRotate = rotateIndexRef.current;
				const atFirstIndex = currentSelected === 0;
				const nextRotateIndex =
					hasLimit && atFirstIndex ? currentRotate + 1 : currentRotate;
				const nextSelectedIndex = atFirstIndex
					? hasLimit
						? currentSelected
						: lastIndex
					: currentSelected - 1;

				rotateIndexRef.current = nextRotateIndex;
				selectedIndexRef.current = nextSelectedIndex;
				setRotateIndex(nextRotateIndex);
				setSelectedIndex(nextSelectedIndex);

				const highlighted = getVisibleItems(nextRotateIndex)[nextSelectedIndex];
				if (highlighted && typeof onHighlight === 'function') {
					onHighlight(highlighted);
				}
			}

			if (input === 'j' || key.downArrow) {
				const currentSelected = Math.min(selectedIndexRef.current, lastIndex);
				const currentRotate = rotateIndexRef.current;
				const atLastIndex = currentSelected === lastIndex;
				const nextRotateIndex =
					hasLimit && atLastIndex ? currentRotate - 1 : currentRotate;
				const nextSelectedIndex = atLastIndex
					? hasLimit
						? currentSelected
						: 0
					: currentSelected + 1;

				rotateIndexRef.current = nextRotateIndex;
				selectedIndexRef.current = nextSelectedIndex;
				setRotateIndex(nextRotateIndex);
				setSelectedIndex(nextSelectedIndex);

				const highlighted = getVisibleItems(nextRotateIndex)[nextSelectedIndex];
				if (highlighted && typeof onHighlight === 'function') {
					onHighlight(highlighted);
				}
			}

			if (/^[1-9]$/.test(input)) {
				const targetIndex = Number.parseInt(input, 10) - 1;
				const visibleItems = getVisibleItems(rotateIndexRef.current);
				const selectedItem = visibleItems[targetIndex];
				if (selectedItem && typeof onSelect === 'function') {
					onSelect(selectedItem);
				}
			}

			if (key.return) {
				const currentSelected = Math.min(selectedIndexRef.current, lastIndex);
				const visibleItems = getVisibleItems(rotateIndexRef.current);
				const selectedItem = visibleItems[currentSelected];
				if (selectedItem && typeof onSelect === 'function') {
					onSelect(selectedItem);
				}
			}
		},
		{isActive: isFocused},
	);

	const visibleItems = getVisibleItems(rotateIndex);
	const activeIndex = Math.min(selectedIndex, lastIndex);

	return (
		<Box flexDirection="column">
			{visibleItems.map((item, index) => {
				const isSelected = index === activeIndex;
				const itemKey =
					item.key ??
					(typeof item.value === 'string' || typeof item.value === 'number'
						? item.value
						: String(item.value));

				return (
					<Box key={itemKey}>
						{/* Fixed-width indicator: Ink trims a trailing space only on rows
						    that overflow, which left truncated rows a column left of short
						    ones. */}
						<Box minWidth={2}>
							<Text color={isSelected ? colors.primary : colors.text}>
								{isSelected ? '>' : ' '}
							</Text>
						</Box>
						{CustomItem ? (
							<CustomItem {...item} isSelected={isSelected} />
						) : (
							// Truncate rather than wrap: a long label (a path, a URL)
							// reflowed with no hanging indent and the list read as a jumble
							// on narrow terminals.
							<Text
								color={isSelected ? colors.primary : colors.text}
								wrap="truncate-end"
							>
								{item.label}
							</Text>
						)}
					</Box>
				);
			})}
		</Box>
	);
}
