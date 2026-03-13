import {Box, Text, useFocus, useInput} from 'ink';
import {Tab, Tabs} from 'ink-tab';
import React, {useEffect, useState} from 'react';
import {TitledBoxWithPreferences} from '@/components/ui/titled-box';
import {
	COST_SCORE_CHEAP,
	COST_SCORE_EXPENSIVE,
	COST_SCORE_FREE,
	COST_SCORE_MODERATE,
} from '@/constants';
import {useTerminalWidth} from '@/hooks/useTerminalWidth';
import {useTheme} from '@/hooks/useTheme';
import {databaseEngine} from '@/model-database/database-engine';
import {Colors, Command, ModelEntry} from '@/types/index';

type TabType = 'latest' | 'open' | 'proprietary';

interface ModelDatabaseDisplayProps {
	onCancel?: () => void;
}

function ModelDatabaseDisplay({onCancel}: ModelDatabaseDisplayProps) {
	const boxWidth = useTerminalWidth();
	const {colors} = useTheme();
	const [openModels, setOpenModels] = useState<ModelEntry[]>([]);
	const [proprietaryModels, setProprietaryModels] = useState<ModelEntry[]>([]);
	const [latestModels, setLatestModels] = useState<ModelEntry[]>([]);
	const [allModels, setAllModels] = useState<ModelEntry[]>([]);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [currentModelIndex, setCurrentModelIndex] = useState(0);
	const [activeTab, setActiveTab] = useState<TabType>('latest');
	const [searchQuery, setSearchQuery] = useState('');
	const [searchMode, setSearchMode] = useState(false);
	const [closed, setClosed] = useState(false);

	// Capture focus to prevent user input from being active
	useFocus({autoFocus: true, id: 'model-database-display'});

	// Get current tab's models with search filtering
	const filterBySearch = (modelList: ModelEntry[]) => {
		if (!searchQuery) return modelList;
		const query = searchQuery.toLowerCase();
		return modelList.filter(
			m =>
				m.name.toLowerCase().includes(query) ||
				m.author.toLowerCase().includes(query) ||
				m.id.toLowerCase().includes(query),
		);
	};

	// Get models for current view
	const getCurrentModels = (): ModelEntry[] => {
		if (searchMode) {
			return filterBySearch(allModels);
		}
		switch (activeTab) {
			case 'latest':
				return latestModels;
			case 'open':
				return openModels;
			case 'proprietary':
				return proprietaryModels;
			default:
				return [];
		}
	};

	const currentTabModels = getCurrentModels();

	// Keyboard handler for navigation
	useInput((input, key) => {
		if (key.escape) {
			if (searchMode) {
				setSearchMode(false);
				setSearchQuery('');
				setCurrentModelIndex(0);
			} else {
				setClosed(true);
				if (onCancel) {
					onCancel();
				}
			}
		} else if (key.return) {
			setClosed(true);
			if (onCancel) {
				onCancel();
			}
		} else if (key.upArrow) {
			setCurrentModelIndex(prev => Math.max(0, prev - 1));
		} else if (key.downArrow) {
			setCurrentModelIndex(prev =>
				Math.min(currentTabModels.length - 1, prev + 1),
			);
		} else if (key.tab && !searchMode) {
			// Cycle through tabs
			const tabs: TabType[] = ['latest', 'open', 'proprietary'];
			const currentIndex = tabs.indexOf(activeTab);
			const nextIndex = (currentIndex + 1) % tabs.length;
			setActiveTab(tabs[nextIndex]);
		} else if (key.backspace || key.delete) {
			if (searchMode) {
				setSearchQuery(prev => {
					const newQuery = prev.slice(0, -1);
					if (newQuery === '') {
						setSearchMode(false);
					}
					return newQuery;
				});
				setCurrentModelIndex(0);
			}
		} else if (input && input.length === 1 && !key.ctrl && !key.meta) {
			if (!searchMode) {
				setSearchMode(true);
			}
			setSearchQuery(prev => prev + input);
			setCurrentModelIndex(0);
		}
	});

	// Reset index when switching tabs
	// biome-ignore lint/correctness/useExhaustiveDependencies: Reset state when activeTab changes is intentional
	useEffect(() => {
		setCurrentModelIndex(0);
	}, [activeTab]);

	useEffect(() => {
		async function loadModels() {
			try {
				const result = await databaseEngine.getDatabasesAsync();

				setOpenModels(result.openModels);
				setProprietaryModels(result.proprietaryModels);
				setLatestModels(result.latestModels);
				setAllModels(result.allModels);
				setLoading(false);
			} catch (error_) {
				setError(
					error_ instanceof Error
						? error_.message
						: 'Failed to fetch model data',
				);
				setLoading(false);
			}
		}

		void loadModels();
	}, []);

	if (closed) {
		return null;
	}

	if (loading) {
		return (
			<TitledBoxWithPreferences
				title="/model-database"
				width={boxWidth}
				borderColor={colors.primary}
				paddingX={2}
				paddingY={1}
			>
				<Text color={colors.text}>Fetching models from OpenRouter...</Text>
			</TitledBoxWithPreferences>
		);
	}

	if (error) {
		return (
			<TitledBoxWithPreferences
				title="/model-database"
				width={boxWidth}
				borderColor={colors.error}
				paddingX={2}
				paddingY={1}
			>
				<Text color={colors.error}>Error: {error}</Text>
			</TitledBoxWithPreferences>
		);
	}

	return (
		<TitledBoxWithPreferences
			title="/model-database"
			width={boxWidth}
			borderColor={colors.primary}
			paddingX={2}
			paddingY={1}
			marginBottom={1}
			flexDirection="column"
		>
			<ModelsTabView
				openModels={openModels}
				proprietaryModels={proprietaryModels}
				latestModels={latestModels}
				colors={colors}
				currentModelIndex={currentModelIndex}
				activeTab={activeTab}
				onTabChange={setActiveTab}
				searchMode={searchMode}
				searchQuery={searchQuery}
				currentTabModels={currentTabModels}
			/>

			<Box marginTop={1} flexDirection="column">
				{searchMode && searchQuery && (
					<Box marginBottom={1}>
						<Text color={colors.primary}>
							Search: <Text bold>{searchQuery}</Text>
						</Text>
					</Box>
				)}

				<Box marginBottom={1}>
					<Text color={colors.secondary} dimColor>
						Data from OpenRouter
					</Text>
				</Box>

				<Text color={colors.secondary} dimColor>
					{searchMode
						? 'Type to search | Backspace to delete | Up/Down: Navigate | Esc: Exit search'
						: 'Type to search | Up/Down: Navigate | Tab: Switch tabs | Esc: Close'}
				</Text>
			</Box>
		</TitledBoxWithPreferences>
	);
}

function ModelsTabView({
	openModels,
	proprietaryModels,
	latestModels,
	colors,
	currentModelIndex,
	activeTab,
	onTabChange,
	searchMode,
	searchQuery,
	currentTabModels,
}: {
	openModels: ModelEntry[];
	proprietaryModels: ModelEntry[];
	latestModels: ModelEntry[];
	colors: Colors;
	currentModelIndex: number;
	activeTab: TabType;
	onTabChange: (tab: TabType) => void;
	searchMode: boolean;
	searchQuery: string;
	currentTabModels: ModelEntry[];
}) {
	const currentModel = currentTabModels[currentModelIndex];

	if (!currentModel) {
		return (
			<Box
				flexDirection="column"
				borderStyle={'round'}
				borderColor={colors.secondary}
				padding={1}
			>
				<Box marginBottom={1}>
					<Text color={colors.primary} bold underline>
						{searchMode ? 'Search Results' : 'Model Browser'}
					</Text>
				</Box>
				{!searchMode && (
					<Tabs
						onChange={name => onTabChange(name as TabType)}
						defaultValue={activeTab}
						colors={{
							activeTab: {
								color: colors.success,
							},
						}}
					>
						<Tab name="latest">Latest ({latestModels.length})</Tab>
						<Tab name="open">Open ({openModels.length})</Tab>
						<Tab name="proprietary">
							Proprietary ({proprietaryModels.length})
						</Tab>
					</Tabs>
				)}
				<Box marginTop={1}>
					<Text color={colors.warning}>
						{searchMode && searchQuery
							? `No models found matching "${searchQuery}"`
							: 'No models available in this category'}
					</Text>
				</Box>
			</Box>
		);
	}

	return (
		<Box
			flexDirection="column"
			borderStyle={'round'}
			borderColor={colors.secondary}
			padding={1}
		>
			<Box marginBottom={1}>
				<Text color={colors.primary} bold underline>
					{searchMode ? 'Search Results' : 'Model Browser'}
				</Text>
			</Box>
			{!searchMode && (
				<Tabs
					onChange={name => onTabChange(name as TabType)}
					defaultValue={activeTab}
					colors={{
						activeTab: {
							color: colors.success,
						},
					}}
				>
					<Tab name="latest">Latest ({latestModels.length})</Tab>
					<Tab name="open">Open ({openModels.length})</Tab>
					<Tab name="proprietary">Proprietary ({proprietaryModels.length})</Tab>
				</Tabs>
			)}

			<Box flexDirection="column" marginTop={1}>
				<Box marginBottom={1}>
					<Text color={colors.secondary} dimColor>
						Model {currentModelIndex + 1} of {currentTabModels.length}
					</Text>
				</Box>
				<ModelItem model={currentModel} colors={colors} />
			</Box>
		</Box>
	);
}

function ModelItem({model, colors}: {model: ModelEntry; colors: Colors}) {
	// Format the created date
	const formatDate = (timestamp: number) => {
		const date = new Date(timestamp * 1000);
		return date.toLocaleDateString('en-US', {
			year: 'numeric',
			month: 'short',
			day: 'numeric',
		});
	};

	// Get cost label based on score
	const getCostLabel = (score: number) => {
		if (score >= COST_SCORE_FREE) return {label: 'Free', color: colors.success};
		if (score >= COST_SCORE_CHEAP)
			return {label: 'Cheap', color: colors.success};
		if (score >= COST_SCORE_MODERATE)
			return {label: 'Moderate', color: colors.primary};
		if (score >= COST_SCORE_EXPENSIVE)
			return {label: 'Expensive', color: colors.warning};
		return {label: 'Premium', color: colors.error};
	};

	const costInfo = getCostLabel(model.quality.cost);

	return (
		<Box flexDirection="column" marginBottom={1}>
			<Box>
				<Text color={colors.primary} bold underline>
					{model.name}
				</Text>
			</Box>
			<Box marginLeft={2} flexDirection="column">
				<Box flexDirection="column">
					<Text color={colors.text}>
						<Text bold>ID: </Text>
						<Text dimColor>{model.id}</Text>
					</Text>
					<Text color={colors.text}>
						<Text bold>Author: </Text>
						{model.author}
					</Text>
					<Text color={colors.text}>
						<Text bold>Context: </Text>
						{model.size} tokens
					</Text>
					<Text color={colors.text}>
						<Text bold>Type: </Text>
						{model.local ? 'Open Weights' : 'Proprietary'}
					</Text>
					<Text color={colors.text}>
						<Text bold>Cost: </Text>
						<Text color={costInfo.color}>{costInfo.label}</Text>
						<Text dimColor> - {model.costDetails}</Text>
					</Text>
					<Text color={colors.text}>
						<Text bold>Tools: </Text>
						{model.hasToolSupport ? (
							<Text color={colors.success}>Supported</Text>
						) : (
							<Text dimColor>Not supported</Text>
						)}
					</Text>
					<Text color={colors.text}>
						<Text bold>Added: </Text>
						{formatDate(model.created)}
					</Text>
				</Box>
			</Box>
		</Box>
	);
}

// Export the display component for use in app.tsx
export {ModelDatabaseDisplay};

export const modelDatabaseCommand: Command = {
	name: 'model-database',
	description: 'Browse coding models from OpenRouter',
	handler: (_args: string[], _messages, _metadata) => {
		return Promise.resolve(React.createElement(React.Fragment));
	},
};
