import {readFile} from 'node:fs/promises';
import {highlight} from 'cli-highlight';
import {Box, Text, useFocus, useInput} from 'ink';
import {useEffect, useMemo, useState} from 'react';
import {StyledTitle} from '@/components/ui/styled-title';
import {
	CHARS_PER_TOKEN_ESTIMATE,
	FILE_EXPLORER_TOKEN_WARNING_THRESHOLD,
	FILE_EXPLORER_VISIBLE_ITEMS,
} from '@/constants';
import {useTheme} from '@/hooks/useTheme';
import {useTitleShape} from '@/hooks/useTitleShape';
import {useUIStateContext} from '@/hooks/useUIState';
import type {FileExplorerProps, ViewMode} from '@/types/file-explorer';
import {
	buildFileTree,
	type FileNode,
	flattenTree,
	flattenTreeAll,
} from '@/utils/file-tree';
import {compressIndentation} from '@/utils/indentation-normalizer';
import {getVSCodeServerSync} from '@/vscode/vscode-server';
import {TreeItem} from './tree-item';
import {
	formatSize,
	formatTokens,
	getAllFilesInDirectory,
	getLanguageFromPath,
} from './utils';

export function FileExplorer({onClose}: FileExplorerProps) {
	const {colors} = useTheme();
	const {currentTitleShape} = useTitleShape();
	const {setPendingFileMentions} = useUIStateContext();

	const [tree, setTree] = useState<FileNode[]>([]);
	const [expanded, setExpanded] = useState<Set<string>>(new Set());
	const [selectedIndex, setSelectedIndex] = useState(0);
	const [selectedFiles, setSelectedFiles] = useState<Set<string>>(new Set());
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [preview, setPreview] = useState<string | null>(null);
	const [previewError, setPreviewError] = useState<string | null>(null);
	const [previewPath, setPreviewPath] = useState<string | null>(null);
	const [viewMode, setViewMode] = useState<ViewMode>('tree');
	const [previewScroll, setPreviewScroll] = useState(0);
	const [searchMode, setSearchMode] = useState(false);
	const [searchQuery, setSearchQuery] = useState('');
	const [closed, setClosed] = useState(false);

	// Capture focus
	useFocus({autoFocus: true, id: 'file-explorer'});

	// Build file tree on mount
	useEffect(() => {
		async function loadTree() {
			try {
				const nodes = await buildFileTree(process.cwd(), {maxDepth: 5});
				setTree(nodes);
				setLoading(false);
			} catch (err) {
				setError(err instanceof Error ? err.message : 'Failed to load files');
				setLoading(false);
			}
		}
		void loadTree();
	}, []);

	// Flatten tree based on expanded state (for normal browsing)
	const flatList = flattenTree(tree, expanded);

	// For search mode, flatten ALL nodes so we can find nested files
	const allNodes = flattenTreeAll(tree);

	// Filter by search query if in search mode
	const filteredList =
		searchMode && searchQuery
			? allNodes.filter(
					item =>
						item.node.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
						item.node.path.toLowerCase().includes(searchQuery.toLowerCase()),
				)
			: flatList;

	// Calculate scroll window
	const scrollStart = Math.max(
		0,
		Math.min(
			selectedIndex - Math.floor(FILE_EXPLORER_VISIBLE_ITEMS / 2),
			filteredList.length - FILE_EXPLORER_VISIBLE_ITEMS,
		),
	);
	const visibleItems = filteredList.slice(
		scrollStart,
		scrollStart + FILE_EXPLORER_VISIBLE_ITEMS,
	);

	// Get selected node
	const selectedNode = filteredList[selectedIndex]?.node;

	// Calculate estimated tokens for selected files
	const estimatedTokens = useMemo(() => {
		if (selectedFiles.size === 0) return 0;
		let totalSize = 0;
		for (const filePath of selectedFiles) {
			// Find the node to get its size
			const node = allNodes.find(n => n.node.path === filePath);
			if (node?.node.size) {
				totalSize += node.node.size;
			}
		}
		// Estimate tokens: chars / 4 (standard approximation)
		return Math.ceil(totalSize / CHARS_PER_TOKEN_ESTIMATE);
	}, [selectedFiles, allNodes]);

	// Load preview when entering preview mode
	const loadPreviewForNode = async (node: FileNode) => {
		if (node.isDirectory) {
			setPreview(null);
			setPreviewError('Cannot preview directory');
			return;
		}

		// If VS Code is connected, open the file there for better viewing
		const vscodeServer = getVSCodeServerSync();
		if (vscodeServer?.hasConnections()) {
			vscodeServer.openFileInVSCode(node.absolutePath);
		}

		try {
			const content = await readFile(node.absolutePath, 'utf-8');
			const lang = getLanguageFromPath(node.path);

			// Compress indentation for compact display in narrow terminals
			const lines = content.split('\n');
			const compressedLines = compressIndentation(lines);
			const compressedContent = compressedLines.join('\n');

			// Apply syntax highlighting
			let highlighted: string;
			try {
				highlighted = highlight(compressedContent, {
					language: lang,
					theme: 'default',
				});
			} catch {
				// Fallback to plain text if highlighting fails
				highlighted = compressedContent;
			}

			setPreview(highlighted);
			setPreviewPath(node.path);
			setPreviewError(null);
			setPreviewScroll(0);
		} catch {
			setPreview(null);
			setPreviewError('Cannot preview (binary or unreadable)');
		}
	};

	const toggleFileSelection = (path: string) => {
		setSelectedFiles(prev => {
			const next = new Set(prev);
			if (next.has(path)) {
				next.delete(path);
			} else {
				next.add(path);
			}
			return next;
		});
	};

	const toggleDirectorySelection = (dirNode: FileNode) => {
		const filesInDir = getAllFilesInDirectory(dirNode);
		if (filesInDir.length === 0) return;

		setSelectedFiles(prev => {
			const next = new Set(prev);
			// Check if all files in directory are already selected
			const allSelected = filesInDir.every(f => prev.has(f));

			if (allSelected) {
				// Deselect all
				for (const f of filesInDir) {
					next.delete(f);
				}
			} else {
				// Select all
				for (const f of filesInDir) {
					next.add(f);
				}
			}
			return next;
		});
	};

	const handleSelect = () => {
		if (!selectedNode) return;

		if (selectedNode.isDirectory) {
			// Toggle directory expansion
			setExpanded(prev => {
				const next = new Set(prev);
				if (next.has(selectedNode.path)) {
					next.delete(selectedNode.path);
				} else {
					next.add(selectedNode.path);
				}
				return next;
			});
		} else {
			// For files, enter preview mode
			setViewMode('preview');
			void loadPreviewForNode(selectedNode);
		}
	};

	const handleGoUp = () => {
		// Find parent directory and collapse it
		if (!selectedNode) return;
		const parts = selectedNode.path.split('/');
		if (parts.length > 1) {
			parts.pop();
			const parentPath = parts.join('/');
			setExpanded(prev => {
				const next = new Set(prev);
				next.delete(parentPath);
				return next;
			});
		}
	};

	// Keyboard handler
	useInput((input, key) => {
		if (key.escape) {
			if (searchMode) {
				setSearchMode(false);
				setSearchQuery('');
			} else if (viewMode === 'preview') {
				setViewMode('tree');
			} else {
				// Exit and pass selected files to input
				setClosed(true);
				if (selectedFiles.size > 0) {
					setPendingFileMentions(Array.from(selectedFiles));
				}
				onClose();
			}
			return;
		}

		// Shift+Tab to go back from preview
		if (key.tab && key.shift) {
			if (viewMode === 'preview') {
				setViewMode('tree');
			}
			return;
		}

		// Preview mode navigation
		if (viewMode === 'preview') {
			if (key.upArrow) {
				setPreviewScroll(prev => Math.max(0, prev - 1));
			} else if (key.downArrow) {
				const lines = preview?.split('\n').length ?? 0;
				setPreviewScroll(prev =>
					Math.min(Math.max(0, lines - FILE_EXPLORER_VISIBLE_ITEMS), prev + 1),
				);
			} else if (input === ' ' && previewPath) {
				// Toggle selection in preview mode
				toggleFileSelection(previewPath);
			}
			return;
		}

		// Search mode input
		if (searchMode) {
			if (key.backspace || key.delete) {
				setSearchQuery(prev => {
					const newQuery = prev.slice(0, -1);
					if (newQuery === '') {
						setSearchMode(false);
					}
					return newQuery;
				});
				setSelectedIndex(0);
			} else if (input && input.length === 1 && !key.ctrl && !key.meta) {
				setSearchQuery(prev => prev + input);
				setSelectedIndex(0);
			} else if (key.upArrow) {
				setSelectedIndex(prev => Math.max(0, prev - 1));
			} else if (key.downArrow) {
				setSelectedIndex(prev => Math.min(filteredList.length - 1, prev + 1));
			} else if (key.return) {
				handleSelect();
			}
			return;
		}

		// Normal tree mode
		if (key.upArrow) {
			setSelectedIndex(prev => Math.max(0, prev - 1));
		} else if (key.downArrow) {
			setSelectedIndex(prev => Math.min(filteredList.length - 1, prev + 1));
		} else if (key.return) {
			handleSelect();
		} else if (input === '/') {
			setSearchMode(true);
		} else if (input === ' ') {
			// Toggle selection with space
			if (selectedNode) {
				if (selectedNode.isDirectory) {
					// Select/deselect all files in directory
					toggleDirectorySelection(selectedNode);
				} else {
					toggleFileSelection(selectedNode.path);
				}
			}
		} else if (key.backspace) {
			// Go up one directory by collapsing current
			handleGoUp();
		}
	});

	if (closed) {
		return null;
	}

	if (loading) {
		return (
			<Box flexDirection="column" paddingX={1}>
				<StyledTitle
					title="/explorer"
					borderColor={colors.primary}
					shape={currentTitleShape}
				/>
				<Text color={colors.text}>Loading file tree...</Text>
			</Box>
		);
	}

	if (error) {
		return (
			<Box flexDirection="column" paddingX={1}>
				<StyledTitle
					title="/explorer"
					borderColor={colors.primary}
					shape={currentTitleShape}
				/>
				<Text color={colors.error}>Error: {error}</Text>
			</Box>
		);
	}

	// Preview mode view
	if (viewMode === 'preview') {
		const previewLines = preview?.split('\n') ?? [];
		const visiblePreviewLines = previewLines.slice(
			previewScroll,
			previewScroll + FILE_EXPLORER_VISIBLE_ITEMS,
		);
		const isSelected = previewPath ? selectedFiles.has(previewPath) : false;

		return (
			<Box flexDirection="column" paddingX={1}>
				{/* Title */}
				<StyledTitle
					title={`/explorer - ${previewPath}`}
					borderColor={colors.primary}
					shape={currentTitleShape}
				/>

				{/* Selection status */}
				<Box marginTop={1}>
					<Text color={isSelected ? colors.success : colors.secondary}>
						{isSelected ? '✓ Selected' : '✗ Not selected'}
					</Text>
					{selectedFiles.size > 0 && (
						<Text color={colors.secondary}>
							{' '}
							| {selectedFiles.size} file(s) (~{formatTokens(estimatedTokens)}{' '}
							tokens)
						</Text>
					)}
				</Box>

				{/* Preview content */}
				<Box flexDirection="column" marginTop={1}>
					{previewError ? (
						<Text color={colors.warning}>{previewError}</Text>
					) : (
						visiblePreviewLines.map((line, i) => (
							<Text key={i} wrap="truncate">
								<Text color={colors.secondary} dimColor>
									{String(previewScroll + i + 1).padStart(4, ' ')}
								</Text>
								<Text color={colors.secondary} dimColor>
									{' | '}
								</Text>
								{line}
							</Text>
						))
					)}
				</Box>

				{/* Scroll indicator */}
				{preview && (
					<Box marginTop={1}>
						<Text color={colors.secondary} dimColor>
							Line {previewScroll + 1}-
							{Math.min(
								previewScroll + FILE_EXPLORER_VISIBLE_ITEMS,
								previewLines.length,
							)}{' '}
							of {previewLines.length}
						</Text>
					</Box>
				)}

				{/* Help text */}
				<Box marginTop={1}>
					<Text color={colors.secondary} dimColor>
						Up/Down: scroll | Space: toggle select | Shift+Tab/Esc: back
					</Text>
				</Box>
			</Box>
		);
	}

	// Tree mode view
	return (
		<Box flexDirection="column" paddingX={1}>
			{/* Title */}
			<StyledTitle
				title="/explorer"
				borderColor={colors.primary}
				shape={currentTitleShape}
			/>

			{/* Search indicator */}
			{searchMode && (
				<Box marginTop={1}>
					<Text color={colors.primary}>
						Search: <Text bold>{searchQuery || '_'}</Text>
					</Text>
				</Box>
			)}

			{/* Selection count */}
			{selectedFiles.size > 0 && (
				<Box marginTop={1} flexDirection="column">
					<Text color={colors.success}>
						{selectedFiles.size} file(s) selected (~
						{formatTokens(estimatedTokens)} tokens)
					</Text>
					{estimatedTokens > FILE_EXPLORER_TOKEN_WARNING_THRESHOLD && (
						<Text color={colors.warning}>That's a lot of context!</Text>
					)}
				</Box>
			)}

			{/* Tree list */}
			<Box flexDirection="column" marginTop={1}>
				{visibleItems.length === 0 ? (
					<Text color={colors.secondary}>
						{searchQuery ? 'No matches found' : 'Empty directory'}
					</Text>
				) : (
					visibleItems.map((item, idx) => {
						const actualIndex = scrollStart + idx;
						const isHighlighted = actualIndex === selectedIndex;
						const isFileSelected = selectedFiles.has(item.node.path);
						return (
							<TreeItem
								key={item.node.path}
								item={item}
								isHighlighted={isHighlighted}
								isSelected={isFileSelected}
								selectedFiles={selectedFiles}
								colors={colors}
							/>
						);
					})
				)}
			</Box>

			{/* Status bar */}
			<Box marginTop={1} flexDirection="column">
				{selectedNode && (
					<Box>
						<Text color={colors.text} dimColor>
							{selectedNode.path}
							{!selectedNode.isDirectory && selectedNode.size !== undefined && (
								<Text> ({formatSize(selectedNode.size)})</Text>
							)}
						</Text>
					</Box>
				)}

				<Box marginTop={1}>
					<Text color={colors.secondary} dimColor>
						{searchMode
							? 'Type to filter | Backspace: delete | Esc: exit search'
							: 'Up/Down: navigate | Enter: expand/preview | Space: select | /: search | Esc: done'}
					</Text>
				</Box>
			</Box>
		</Box>
	);
}
