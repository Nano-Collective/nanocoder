import {Box, Text, useInput} from 'ink';
import {
	type ReactNode,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from 'react';
import TextInput from '@/components/text-input';
import {TitledBoxWithPreferences} from '@/components/ui/titled-box';
import {useResponsiveTerminal} from '@/hooks/useTerminalWidth';
import {useTheme} from '@/hooks/useTheme';
import type {Colors} from '@/types/ui';
import {
	addSibling,
	buildPath,
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

type EditMode = 'browse' | 'edit' | 'add-key';

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

	// Edit mode. Ink dispatches every keypress parsed from one stdin chunk in the
	// same call stack with no re-render between, so the key handler must branch on
	// a ref — reading the state would still say 'browse' for the rest of a pasted
	// "e"+value burst and let those characters run as bare shortcuts.
	const [editMode, setEditModeState] = useState<EditMode>('browse');
	const editModeRef = useRef<EditMode>('browse');
	const setEditMode = useCallback((next: EditMode) => {
		editModeRef.current = next;
		setEditModeState(next);
	}, []);
	const [editValue, setEditValue] = useState('');
	const [editError, setEditError] = useState<string | null>(null);

	// Help modal (same stale-within-a-chunk caveat as editMode above)
	const [showHelp, setShowHelpState] = useState(false);
	const showHelpRef = useRef(false);
	const setShowHelp = useCallback((next: boolean) => {
		showHelpRef.current = next;
		setShowHelpState(next);
	}, []);

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
		const targetPath = buildPath(initialPath);
		const foundIdx = rows.findIndex(
			r => r.path === targetPath || r.path.endsWith(`.${targetPath}`),
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
		// Containers hold no scalar to edit — l/→ expands them instead. Editing a
		// collapsed one used to replace the whole subtree with the string "{ ... }".
		if (currentRow.kind === 'object' || currentRow.kind === 'array') return;

		setEditMode('edit');
		setEditValue(currentRow.value.replace(/^"|"$/g, ''));
		setEditError(null);
	}, [readOnly, currentRow, setEditMode]);

	const commitEdit = useCallback(() => {
		if (!currentRow) return;
		const segments = currentRow.pathSegments;
		let newValue: unknown = editValue;

		// Type coercion. A bad number keeps the editor open — the old fallback wrote
		// currentRow.value, the FORMATTED display string, silently retyping 42 as "42".
		if (currentRow.kind === 'number') {
			const trimmed = editValue.trim();
			const num = Number(trimmed);
			if (trimmed === '' || Number.isNaN(num)) {
				setEditError('not a number');
				return;
			}
			newValue = num;
		} else if (currentRow.kind === 'boolean') {
			newValue = editValue.toLowerCase() === 'true';
		} else if (currentRow.kind === 'null') {
			newValue = editValue.toLowerCase() === 'null' ? null : editValue;
		}

		setTree(prev => setValueAtPath(prev, segments, newValue));
		setEditMode('browse');
		setEditValue('');
		setEditError(null);
	}, [currentRow, editValue, setEditMode]);

	const cancelEdit = useCallback(() => {
		setEditMode('browse');
		setEditValue('');
		setEditError(null);
	}, [setEditMode]);

	const startAdd = useCallback(() => {
		if (readOnly || !currentRow) return;
		setEditMode('add-key');
		setEditValue('');
	}, [readOnly, currentRow, setEditMode]);

	const commitAdd = useCallback(() => {
		if (!currentRow) return;
		const segments = currentRow.pathSegments;
		const parsed = parseKeyValueInput(editValue);
		setTree(prev => addSibling(prev, segments, parsed));
		setEditMode('browse');
		setEditValue('');
	}, [currentRow, editValue, setEditMode]);

	const deleteItem = useCallback(() => {
		if (readOnly || !currentRow) return;
		// Can't delete root
		if (currentRow.pathSegments.length === 0) return;
		// Can't delete closing brackets
		if (currentRow.value === '}' || currentRow.value === ']') return;
		// An opening bracket row shares the container's path, so this removes the
		// whole node rather than just the bracket line.
		setTree(prev => deleteAtPath(prev, currentRow.pathSegments));
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
		// Escape handling
		if (key.escape) {
			if (showHelpRef.current) {
				setShowHelp(false);
				return;
			}
			if (editModeRef.current !== 'browse') {
				cancelEdit();
				return;
			}
			handleExit();
			return;
		}

		// Shift+Tab = exit
		if (key.shift && key.tab) {
			if (editModeRef.current !== 'browse') {
				cancelEdit();
				return;
			}
			handleExit();
			return;
		}

		// Boolean editing: pick the value with arrow keys / space instead of typing.
		if (editModeRef.current === 'edit' && currentRow?.kind === 'boolean') {
			if (
				key.leftArrow ||
				key.rightArrow ||
				key.upArrow ||
				key.downArrow ||
				input === ' '
			) {
				setEditValue(v => (v === 'true' ? 'false' : 'true'));
				return;
			}
			if (key.return) {
				commitEdit();
				return;
			}
			return;
		}

		// If in edit mode, let TextInput handle input. Everything below this line is
		// a bare-letter shortcut, so it MUST stay here: TextInput runs its own
		// useInput and both hooks see every keystroke, so typing a value containing
		// w/q/? used to save, cancel or pop the help overlay mid-edit.
		if (editModeRef.current !== 'browse') return;

		// Help toggle
		if (input === '?' && !key.ctrl && !key.shift) {
			setShowHelp(!showHelpRef.current);
			return;
		}

		// If help is showing, only allow escape and ?
		if (showHelpRef.current) return;

		if (input === 'w' && !key.ctrl && !key.shift) {
			saveChanges();
			return;
		}
		if (input === 'q' && !key.ctrl && !key.shift) {
			handleExit();
			return;
		}

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
				width={isNarrow ? '100%' : boxWidth}
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
			width={isNarrow ? '100%' : boxWidth}
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
								{globalIndex === cursorIndex && editMode === 'edit' ? (
									<EditRow
										row={row}
										indent={indentStr.repeat(row.indent)}
										colors={colors}
										editValue={editValue}
										setEditValue={setEditValue}
										onSubmit={commitEdit}
									/>
								) : isHighlighted ? (
									<Text
										color={colors.base}
										backgroundColor={colors.primary}
										bold
										wrap="truncate-end"
									>
										{renderRowContent(row, indentStr, colors, true)}
									</Text>
								) : (
									/* truncate, don't wrap: a long value (an API key) used to
									   reflow onto the next line and swallow its gutter number */
									<Text wrap="truncate-end">
										{renderRowContent(row, indentStr, colors, false)}
									</Text>
								)}

								{/* Add-key overlay: entering a new "key": value pair. */}
								{globalIndex === cursorIndex && editMode === 'add-key' && (
									<Box>
										<Text color={colors.warning}>
											{' '}
											<TextInput
												value={editValue}
												onChange={setEditValue}
												onSubmit={commitAdd}
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
			<Box marginTop={1} flexDirection={isNarrow ? 'column' : 'row'}>
				<Box flexGrow={1}>
					{editError ? (
						<Text color={colors.error}>
							{editError} — Esc to cancel, or fix the value
						</Text>
					) : (
						<Text color={colors.secondary}>
							{currentRow ? `${currentRow.path}  ` : ''}
							Line {currentRow?.lineNumber ?? 0}/{rows.length}
						</Text>
					)}
				</Box>
				<Box flexDirection="row" justifyContent="flex-end">
					<Text color={colors.secondary}>
						{`${readOnly ? '' : 'e:edit  a:add  d:del  w:write  '}?:help  q:exit`}
					</Text>
				</Box>
			</Box>
		</TitledBoxWithPreferences>
	);
}

// ─── Render Helpers ──────────────────────────────────────────────────────────

/**
 * In-place editor for the row under the cursor: the input sits where the value
 * was (inside the quotes for strings, so the cursor lands on the text), and
 * booleans are picked with the arrow keys instead of typed.
 */
function EditRow({
	row,
	indent,
	colors,
	editValue,
	setEditValue,
	onSubmit,
}: {
	row: JsonFlatRow;
	indent: string;
	colors: Colors;
	editValue: string;
	setEditValue: (value: string) => void;
	onSubmit: () => void;
}): ReactNode {
	const input = (
		<TextInput
			value={editValue}
			onChange={setEditValue}
			onSubmit={onSubmit}
			focus
		/>
	);

	let editor: ReactNode;
	if (row.kind === 'boolean') {
		editor = (
			<Text>
				<Text
					color={editValue === 'true' ? colors.primary : colors.secondary}
					bold={editValue === 'true'}
				>
					true
				</Text>
				<Text color={colors.secondary}> </Text>
				<Text
					color={editValue === 'false' ? colors.primary : colors.secondary}
					bold={editValue === 'false'}
				>
					false
				</Text>
				<Text color={colors.secondary}> ←/→ to change</Text>
			</Text>
		);
	} else if (row.kind === 'string') {
		editor = <Text color={colors.warning}>"{input}"</Text>;
	} else {
		editor = <Text color={colors.warning}>{input}</Text>;
	}

	return (
		<Box>
			<Text color={colors.text}>{indent}</Text>
			{row.key !== undefined && (
				<Text>
					<Text color={colors.primary} bold>
						"{row.key}"
					</Text>
					<Text color={colors.secondary}>: </Text>
				</Text>
			)}
			{editor}
		</Box>
	);
}

function renderRowContent(
	row: JsonFlatRow,
	indentStr: string,
	colors: Colors,
	isHighlighted: boolean,
): ReactNode {
	const indent = indentStr.repeat(row.indent);
	// The cursor row is drawn on a colors.primary background. Syntax colors are
	// picked for the normal background, and the key's own colors.primary rendered
	// it invisible against it, so let the row inherit the inverse pair instead.
	const tint = (color: string) => (isHighlighted ? undefined : color);

	return (
		<>
			<Text color={tint(colors.text)}>{indent}</Text>
			{row.key !== undefined && (
				<>
					<Text color={tint(colors.primary)} bold>
						"{row.key}"
					</Text>
					<Text color={tint(colors.secondary)}>: </Text>
				</>
			)}
			{row.kind === 'object' || row.kind === 'array' ? (
				<Text color={tint(getBracketColor(row.kind, colors))} bold>
					{row.value}
				</Text>
			) : (
				<Text color={tint(getValueColor(row.kind, colors))}>{row.value}</Text>
			)}
			<Text color={tint(colors.secondary)}>{row.trailing}</Text>
			{row.isCollapsed && row.hiddenCount > 0 && (
				<Text color={tint(colors.secondary)}> ({row.hiddenCount} hidden)</Text>
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
