import {Box, Text, useInput} from 'ink';
import TextInput from '@/components/text-input';
import {type ReactNode, useCallback, useEffect, useMemo, useState} from 'react';
import {TitledBoxWithPreferences} from '@/components/ui/titled-box';
import {useResponsiveTerminal} from '@/hooks/useTerminalWidth';
import {useTheme} from '@/hooks/useTheme';
import type {Colors} from '@/types/ui';
import {
	addSibling,
	collapseBeyondDepth,
	deleteAtPath,
	extractTreeValue,
	flattenTree,
	type JsonFlatRow,
	type JsonNode,
	parseJsonToTree,
	parseKeyValueInput,
	setValueAtPath,
	toggleCollapse,
} from './json-tree';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface JsonViewerProps {
	/** JSON data to display and edit */
	data: unknown;
	/** Display title (e.g. filename) */
	title?: string;
	/** Path to the config file (shown in status bar) */
	filePath?: string;
	/** Callback when changes are saved to disk */
	onSave?: (data: unknown) => void;
	/** Callback fired whenever the tree changes — carries current data */
	onChange?: (data: unknown) => void;
	/** Callback to exit the viewer — carries current data for dirty check */
	onCancel?: (currentData: unknown) => void;
	/** Auto-collapse nodes beyond this depth (default: 4) */
	initialCollapsedDepth?: number;
	/** Pre-navigate cursor to this JSONPath segments array */
	initialPath?: string[];
	/** Read-only mode — disables edit/add/delete */
	readOnly?: boolean;
}

type EditMode = 'browse' | 'edit' | 'add-key' | 'add-value';

// ─── Color Helpers ───────────────────────────────────────────────────────────

function getValueColor(kind: string, colors: Colors): string {
	switch (kind) {
		case 'string':
			return colors.success;
		case 'number':
			return colors.info;
		case 'boolean':
			return colors.warning;
		case 'null':
			return colors.secondary;
		default:
			return colors.text;
	}
}

function getBracketColor(kind: string, colors: Colors): string {
	return kind === 'object' ? colors.primary : colors.tool;
}

// ─── Main Component ──────────────────────────────────────────────────────────

export function JsonViewer({
	data,
	title,
	filePath,
	onSave,
	onChange,
	onCancel,
	initialCollapsedDepth = 4,
	initialPath,
	readOnly = false,
}: JsonViewerProps) {
	const {colors} = useTheme();
	const {boxWidth, isNarrow} = useResponsiveTerminal();

	// Tree state
	const [tree, setTree] = useState<JsonNode>(() => {
		let t = parseJsonToTree(data);
		if (initialCollapsedDepth > 0) {
			t = collapseBeyondDepth(t, initialCollapsedDepth);
		}
		return t;
	});

	// Cursor position (index into flattened rows)
	const [cursorIndex, setCursorIndex] = useState(0);

	// Edit mode
	const [editMode, setEditMode] = useState<EditMode>('browse');
	const [editValue, setEditValue] = useState('');

	// Help modal
	const [showHelp, setShowHelp] = useState(false);

	// Dirty tracking
	const originalData = JSON.stringify(data);
	const isDirty = JSON.stringify(extractTreeValue(tree)) !== originalData;

	// Flatten tree for rendering
	const rows = useMemo(() => flattenTree(tree), [tree]);

	// Notify parent whenever the tree changes
	useEffect(() => {
		onChange?.(extractTreeValue(tree));
	}, [tree, onChange]);

	// Visible rows (viewport)
	const viewportHeight = isNarrow ? 15 : 20;
	const [scrollOffset, setScrollOffset] = useState(0);

	// Ensure cursor stays in bounds
	useEffect(() => {
		if (cursorIndex >= rows.length) {
			setCursorIndex(Math.max(0, rows.length - 1));
		}
	}, [rows.length, cursorIndex]);

	// Scroll to keep cursor visible
	useEffect(() => {
		if (cursorIndex < scrollOffset) {
			setScrollOffset(cursorIndex);
		} else if (cursorIndex >= scrollOffset + viewportHeight) {
			setScrollOffset(cursorIndex - viewportHeight + 1);
		}
	}, [cursorIndex, viewportHeight, scrollOffset]);

	// Navigate to initial path
	useEffect(() => {
		if (!initialPath || initialPath.length === 0 || rows.length === 0) return;
		const targetPath = initialPath.join('');
		const foundIdx = rows.findIndex(
			r =>
				r.pathSegments.join('') === targetPath || r.path.endsWith(targetPath),
		);
		if (foundIdx >= 0) {
			setCursorIndex(foundIdx);
			setScrollOffset(Math.max(0, foundIdx - Math.floor(viewportHeight / 2)));
		}
	}, [viewportHeight, rows, initialPath]);

	// Current row
	const currentRow = rows[cursorIndex];

	// ─── Actions ───────────────────────────────────────────────────────────

	const moveCursor = useCallback(
		(delta: number) => {
			setCursorIndex(prev =>
				Math.max(0, Math.min(rows.length - 1, prev + delta)),
			);
		},
		[rows.length],
	);

	const expandNode = useCallback(() => {
		if (!currentRow?.hasChildren) return;
		setTree(prev => toggleCollapse(prev, currentRow.pathSegments));
		// After expanding, cursor will shift — handled by useEffect
	}, [currentRow]);

	const collapseNode = useCallback(() => {
		if (!currentRow?.hasChildren || currentRow.isCollapsed) return;
		setTree(prev => toggleCollapse(prev, currentRow.pathSegments));
	}, [currentRow]);

	const startEdit = useCallback(() => {
		if (readOnly || !currentRow) return;
		// Can edit primitives or collapsed nodes (expand first)
		if (currentRow.hasChildren && !currentRow.isCollapsed) return;
		if (
			currentRow.value === '{' ||
			currentRow.value === '}' ||
			currentRow.value === '[' ||
			currentRow.value === ']'
		)
			return;

		setEditMode('edit');
		setEditValue(currentRow.value.replace(/^"|"$/g, ''));
	}, [readOnly, currentRow]);

	const commitEdit = useCallback(() => {
		if (!currentRow) return;
		const segments = currentRow.pathSegments;
		let newValue: unknown = editValue;

		// Type coercion
		if (currentRow.kind === 'number') {
			const num = Number(editValue);
			newValue = Number.isNaN(num) ? currentRow.value : num;
		} else if (currentRow.kind === 'boolean') {
			newValue = editValue.toLowerCase() === 'true';
		} else if (currentRow.kind === 'null') {
			newValue = editValue.toLowerCase() === 'null' ? null : editValue;
		}

		setTree(prev => setValueAtPath(prev, segments, newValue));
		setEditMode('browse');
		setEditValue('');
	}, [currentRow, editValue]);

	const cancelEdit = useCallback(() => {
		setEditMode('browse');
		setEditValue('');
	}, []);

	const startAdd = useCallback(() => {
		if (readOnly || !currentRow) return;
		setEditMode('add-key');
		setEditValue('');
	}, [readOnly, currentRow]);

	const commitAdd = useCallback(() => {
		if (!currentRow) return;
		const segments = currentRow.pathSegments;
		const parsed = parseKeyValueInput(editValue);
		setTree(prev => addSibling(prev, segments, parsed));
		setEditMode('browse');
		setEditValue('');
	}, [currentRow, editValue]);

	const deleteItem = useCallback(() => {
		if (readOnly || !currentRow) return;
		// Can't delete root
		if (currentRow.pathSegments.length === 0) return;
		// Can't delete closing brackets
		if (currentRow.value === '}' || currentRow.value === ']') return;
		// Can't delete opening brackets — delete the whole node
		const segments =
			currentRow.hasChildren && !currentRow.isCollapsed
				? currentRow.pathSegments
				: currentRow.pathSegments;
		setTree(prev => deleteAtPath(prev, segments));
	}, [readOnly, currentRow]);

	const saveChanges = useCallback(() => {
		const value = extractTreeValue(tree);
		onSave?.(value);
	}, [tree, onSave]);

	const handleExit = useCallback(() => {
		onCancel?.(extractTreeValue(tree));
	}, [tree, onCancel]);

	// ─── Key Handling ──────────────────────────────────────────────────────

	useInput((input, key) => {
		// Help toggle (always available)
		if (input === '?' && !key.ctrl && !key.shift) {
			setShowHelp(prev => !prev);
			return;
		}

		// Escape handling
		if (key.escape) {
			if (showHelp) {
				setShowHelp(false);
				return;
			}
			if (editMode !== 'browse') {
				cancelEdit();
				return;
			}
			handleExit();
			return;
		}

		// Shift+Tab = exit
		if (key.shift && key.tab) {
			if (editMode !== 'browse') {
				cancelEdit();
				return;
			}
			handleExit();
			return;
		}

		// Save/exit shortcuts (always available, like ?)
		if (input === 'w' && !key.ctrl && !key.shift) {
			saveChanges();
			return;
		}
		if (input === 'q' && !key.ctrl && !key.shift) {
			if (editMode !== 'browse') {
				cancelEdit();
				return;
			}
			handleExit();
			return;
		}

		// If in edit mode, let TextInput handle input
		if (editMode !== 'browse') return;

		// If help is showing, only allow escape and ?
		if (showHelp) return;

		// Navigation
		if (input === 'k' || key.upArrow) {
			moveCursor(-1);
		} else if (input === 'j' || key.downArrow) {
			moveCursor(1);
		} else if (input === 'l' || key.rightArrow) {
			expandNode();
		} else if (input === 'h' || key.leftArrow || key.backspace) {
			collapseNode();
		} else if (key.return || input === 'e') {
			startEdit();
		} else if (input === 'a') {
			startAdd();
		} else if (input === 'd') {
			deleteItem();
		}
	});

	// ─── Render ────────────────────────────────────────────────────────────

	const indentStr = '  ';

	if (showHelp) {
		return (
			<TitledBoxWithPreferences
				title="Keybindings"
				width={boxWidth}
				borderColor={colors.primary}
				paddingX={2}
				paddingY={1}
				flexDirection="column"
				marginBottom={1}
			>
				<Text color={colors.secondary} bold>
					Navigation
				</Text>
				<HelpRow label="Move up" keybind="k / ↑" colors={colors} />
				<HelpRow label="Move down" keybind="j / ↓" colors={colors} />
				<HelpRow label="Expand" keybind="l / →" colors={colors} />
				<HelpRow label="Collapse" keybind="h / ← / Backspace" colors={colors} />
				<Box marginTop={1} />
				<Text color={colors.secondary} bold>
					Editing
				</Text>
				<HelpRow label="Edit value" keybind="e / Enter" colors={colors} />
				<HelpRow label="Add sibling" keybind="a" colors={colors} />
				<HelpRow label="Delete" keybind="d" colors={colors} />
				<HelpRow label="Save to disk" keybind="w" colors={colors} />
				<Box marginTop={1} />
				<Text color={colors.secondary} bold>
					General
				</Text>
				<HelpRow label="Toggle help" keybind="?" colors={colors} />
				<HelpRow
					label="Exit (with dirty check)"
					keybind="q / Esc / Shift+Tab"
					colors={colors}
				/>
				<Box marginTop={1} />
				<Text color={colors.secondary}>Press ? or Esc to close</Text>
			</TitledBoxWithPreferences>
		);
	}

	return (
		<TitledBoxWithPreferences
			title={title || 'JSON Viewer'}
			width={boxWidth}
			borderColor={colors.primary}
			paddingX={isNarrow ? 1 : 2}
			paddingY={0}
			flexDirection="column"
			marginBottom={1}
		>
			{/* Header */}
			<Box marginBottom={1}>
				<Text color={colors.secondary}>
					{filePath ? `${filePath}  ` : ''}
					{rows.length} line{rows.length !== 1 ? 's' : ''}
					{isDirty ? '  ● modified' : ''}
					{readOnly ? '  (read-only)' : ''}
				</Text>
			</Box>

			{/* JSON Content */}
			<Box
				borderStyle="round"
				borderColor={isDirty ? colors.warning : colors.secondary}
				paddingX={1}
				flexDirection="column"
			>
				{rows
					.slice(scrollOffset, scrollOffset + viewportHeight)
					.map((row, i) => {
						const globalIndex = scrollOffset + i;
						const isHighlighted =
							globalIndex === cursorIndex && editMode === 'browse';

						return (
							<Box key={globalIndex}>
								{/* Line number */}
								<Text color={colors.secondary}>
									{String(row.lineNumber).padStart(3, ' ')}
								</Text>
								<Text color={isHighlighted ? colors.primary : colors.text}>
									{' '}
								</Text>

								{/* Highlighted row gets inverse */}
								{isHighlighted ? (
									<Text
										color={colors.base}
										backgroundColor={colors.primary}
										bold
									>
										{renderRowContent(row, indentStr, colors, true)}
									</Text>
								) : (
									<Text>{renderRowContent(row, indentStr, colors, false)}</Text>
								)}

								{/* Edit input overlay */}
								{globalIndex === cursorIndex && editMode !== 'browse' && (
									<Box>
										<Text color={colors.warning}>
											{' '}
											<TextInput
												value={editValue}
												onChange={setEditValue}
												onSubmit={
													editMode === 'add-key' ? commitAdd : commitEdit
												}
												focus
											/>
										</Text>
									</Box>
								)}
							</Box>
						);
					})}
			</Box>

			{/* Status Bar */}
			<Box marginTop={1} flexDirection="row">
				<Box>
					<Text color={colors.secondary}>
						{currentRow ? `${currentRow.path}  ` : ''}
						Line {currentRow?.lineNumber ?? 0}/{rows.length}
					</Text>
				</Box>
				<Box
					width={isNarrow ? undefined : '50%'}
					flexDirection="row"
					justifyContent="flex-end"
				>
					<Text color={colors.secondary}>
						{!readOnly && 'e:edit  a:add  d:del  w:write  '}' '?:help ' 'q:exit'
					</Text>
				</Box>
			</Box>
		</TitledBoxWithPreferences>
	);
}

// ─── Render Helpers ──────────────────────────────────────────────────────────

function renderRowContent(
	row: JsonFlatRow,
	indentStr: string,
	colors: Colors,
	_isHighlighted: boolean,
): ReactNode {
	const indent = indentStr.repeat(row.indent);

	return (
		<>
			<Text color={colors.text}>{indent}</Text>
			{row.key !== undefined && (
				<>
					<Text color={colors.primary} bold>
						"{row.key}"
					</Text>
					<Text color={colors.secondary}>: </Text>
				</>
			)}
			{row.kind === 'object' || row.kind === 'array' ? (
				<Text color={getBracketColor(row.kind, colors)} bold>
					{row.value}
				</Text>
			) : (
				<Text color={getValueColor(row.kind, colors)}>{row.value}</Text>
			)}
			<Text color={colors.secondary}>{row.trailing}</Text>
			{row.isCollapsed && row.hiddenCount > 0 && (
				<Text color={colors.secondary}> ({row.hiddenCount} hidden)</Text>
			)}
		</>
	);
}

function HelpRow({
	label,
	keybind,
	colors,
}: {
	label: string;
	keybind: string;
	colors: Colors;
}) {
	return (
		<Box>
			<Text color={colors.primary} bold>{`${keybind}`}</Text>
			<Text color={colors.text}> — {label}</Text>
		</Box>
	);
}
