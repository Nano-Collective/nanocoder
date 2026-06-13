import {Box, Text, useInput} from 'ink';
import {useMemo, useState} from 'react';
import {getColors} from '@/config/index';
import type {FetchedModel} from '../utils/fetch-models';

const MODEL_SELECTION_VISIBLE_ITEMS = 12;
const PAGE_SIZE = MODEL_SELECTION_VISIBLE_ITEMS;

interface ModelSelectionListProps {
	models: FetchedModel[];
	selectedIds: Set<string>;
	title: string;
	error: string | null;
	isNarrow: boolean;
	onToggle: (modelId: string) => void;
	onSelectAll: () => void;
	onDone: () => void;
	onBack: () => void;
	onManualEntry: () => void;
}

export function ModelSelectionList({
	models,
	selectedIds,
	title,
	error,
	isNarrow,
	onToggle,
	onSelectAll,
	onDone,
	onBack,
	onManualEntry,
}: ModelSelectionListProps) {
	const colors = getColors();
	const [selectedIndex, setSelectedIndex] = useState(0);
	const [searchMode, setSearchMode] = useState(false);
	const [searchQuery, setSearchQuery] = useState('');

	const filteredModels = useMemo(() => {
		const normalizedQuery = searchQuery.trim().toLowerCase();
		if (!normalizedQuery) return models;

		return models.filter(
			model =>
				model.name.toLowerCase().includes(normalizedQuery) ||
				model.id.toLowerCase().includes(normalizedQuery),
		);
	}, [models, searchQuery]);

	const maxIndex = Math.max(0, filteredModels.length - 1);
	const highlightedIndex = Math.min(selectedIndex, maxIndex);
	const highlightedModel = filteredModels[highlightedIndex];
	const scrollStart = Math.max(
		0,
		Math.min(
			highlightedIndex - Math.floor(MODEL_SELECTION_VISIBLE_ITEMS / 2),
			filteredModels.length - MODEL_SELECTION_VISIBLE_ITEMS,
		),
	);
	const visibleModels = filteredModels.slice(
		scrollStart,
		scrollStart + MODEL_SELECTION_VISIBLE_ITEMS,
	);
	const allSelected = models.length > 0 && selectedIds.size === models.length;
	const resultStart = filteredModels.length === 0 ? 0 : scrollStart + 1;
	const resultEnd = scrollStart + visibleModels.length;

	const toggleHighlightedModel = () => {
		if (highlightedModel) {
			onToggle(highlightedModel.id);
		}
	};

	useInput((input, key) => {
		if (key.escape) {
			if (searchMode) {
				setSearchMode(false);
				setSearchQuery('');
				setSelectedIndex(0);
			} else {
				onBack();
			}
			return;
		}

		if (key.shift && key.tab) {
			onBack();
			return;
		}

		if (searchMode) {
			if (key.backspace || key.delete) {
				setSearchQuery(prev => {
					const nextQuery = prev.slice(0, -1);
					if (nextQuery === '') {
						setSearchMode(false);
					}
					return nextQuery;
				});
				setSelectedIndex(0);
			} else if (key.upArrow) {
				setSelectedIndex(prev => Math.max(0, prev - 1));
			} else if (key.downArrow) {
				setSelectedIndex(prev => Math.min(maxIndex, prev + 1));
			} else if (key.pageUp) {
				setSelectedIndex(prev => Math.max(0, prev - PAGE_SIZE));
			} else if (key.pageDown) {
				setSelectedIndex(prev => Math.min(maxIndex, prev + PAGE_SIZE));
			} else if (key.return || input === ' ') {
				toggleHighlightedModel();
			} else if (input && input.length === 1 && !key.ctrl && !key.meta) {
				setSearchQuery(prev => prev + input);
				setSelectedIndex(0);
			}
			return;
		}

		if (key.upArrow) {
			setSelectedIndex(prev => Math.max(0, prev - 1));
		} else if (key.downArrow) {
			setSelectedIndex(prev => Math.min(maxIndex, prev + 1));
		} else if (key.pageUp) {
			setSelectedIndex(prev => Math.max(0, prev - PAGE_SIZE));
		} else if (key.pageDown) {
			setSelectedIndex(prev => Math.min(maxIndex, prev + PAGE_SIZE));
		} else if (key.return || input === ' ') {
			toggleHighlightedModel();
		} else if (input === '/') {
			setSearchMode(true);
			setSelectedIndex(0);
		} else if (input === 'a') {
			onSelectAll();
		} else if (input === 'd') {
			onDone();
		} else if (input === 'm') {
			onManualEntry();
		}
	});

	return (
		<Box flexDirection="column">
			<Box marginBottom={1}>
				<Text bold color={colors.primary}>
					{title}
				</Text>
			</Box>

			<Box marginBottom={1} flexDirection="column">
				<Text>
					{selectedIds.size} selected | {resultStart}-{resultEnd}/
					{filteredModels.length} models
					{searchQuery ? ` | filter: ${searchQuery}` : ''}
				</Text>
				<Text color={allSelected ? colors.success : colors.secondary}>
					{allSelected
						? '[✓] All models selected (press a to deselect all)'
						: '[ ] Press a to select all models'}
				</Text>
			</Box>

			{searchMode && (
				<Box marginBottom={1}>
					<Text color={colors.primary}>
						Search models: <Text bold>{searchQuery || '_'}</Text>
					</Text>
				</Box>
			)}

			<Box flexDirection="column">
				{visibleModels.length === 0 ? (
					<Text color={colors.secondary}>
						{searchQuery ? 'No matching models' : 'No models available'}
					</Text>
				) : (
					visibleModels.map((model, index) => {
						const actualIndex = scrollStart + index;
						const isHighlighted = actualIndex === highlightedIndex;
						const isSelected = selectedIds.has(model.id);
						return (
							<Text
								key={model.id}
								color={isHighlighted ? colors.primary : colors.text}
								bold={isHighlighted}
							>
								{isHighlighted ? '❯' : ' '} {isSelected ? '[✓]' : '[ ]'}{' '}
								{model.name === model.id
									? model.id
									: `${model.name} — ${model.id}`}
							</Text>
						);
					})
				)}
			</Box>

			<Box marginTop={1}>
				<Text color={colors.success}>Done is always available: press d</Text>
			</Box>

			{error && (
				<Box marginTop={1}>
					<Text color={colors.error}>{error}</Text>
				</Box>
			)}

			{isNarrow ? (
				<Box flexDirection="column" marginTop={1}>
					<Text color={colors.secondary}>↑/↓: navigate</Text>
					<Text color={colors.secondary}>Enter/Space: toggle</Text>
					<Text color={colors.secondary}>
						/: search | a: all | d: done | m: manual
					</Text>
					<Text color={colors.secondary}>Esc/Shift+Tab: back</Text>
				</Box>
			) : (
				<Box marginTop={1}>
					<Text color={colors.secondary}>
						Up/Down: navigate | Enter/Space: toggle | /: search | a: select all
						| d: done | m: manual entry | Esc/Shift+Tab: back
					</Text>
				</Box>
			)}
		</Box>
	);
}
