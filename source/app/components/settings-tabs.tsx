import chalk from 'chalk';
import {Box, Text, useInput} from 'ink';
import type {ReactElement} from 'react';
import {useEffect, useMemo, useRef, useState} from 'react';
import {StyledTitle} from '@/components/ui/styled-title';
import {
	getAlternateScreen,
	getNanocoderShape,
	getNotificationsPreference,
	getPasteThreshold,
	getPrivacyPreference,
	updateAlternateScreen,
} from '@/config/preferences';
import {useResponsiveTerminal} from '@/hooks/useTerminalWidth';
import {useTheme} from '@/hooks/useTheme';
import {useTitleShape} from '@/hooks/useTitleShape';
import {fuzzyScore} from '@/utils/fuzzy-matching';
import {DEFAULT_SINGLE_LINE_PASTE_THRESHOLD} from '@/utils/paste-utils';
import type {
	ManagedSettingsPanel,
	SettingsSelectorProps,
} from './settings-selector';
import {
	SettingsDisplayPanel,
	SettingsNanocoderShapePanel,
	SettingsNotificationsPanel,
	SettingsPasteThresholdPanel,
	SettingsPrivacyPanel,
	SettingsThemePanel,
	SettingsTitleShapePanel,
} from './settings-selector';
import {SettingsJsonConfigPanel} from './settings-json-config';

/**
 * Tab categories are our own settings, grouped for browsability — not the
 * Status/Config/Usage read-only surfaces (those live at /status and /usage).
 * Every existing preference must be reachable from exactly one of these
 * four tabs.
 */
export type SettingsTabId = 'appearance' | 'input' | 'display' | 'advanced';

interface TabDefinition {
	id: SettingsTabId;
	label: string;
}

const TABS: TabDefinition[] = [
	{id: 'appearance', label: 'Appearance'},
	{id: 'input', label: 'Input'},
	{id: 'display', label: 'Display'},
	{id: 'advanced', label: 'Advanced'},
];

type SettingRow =
	| {
			kind: 'boolean';
			id: string;
			label: string;
			value: boolean;
			onToggle: () => void;
	  }
	| {
			kind: 'number';
			id: string;
			label: string;
			value: number;
			panel: ManagedSettingsPanel;
	  }
	| {
			kind: 'managed';
			id: string;
			label: string;
			value: string;
			panel: ManagedSettingsPanel;
	  };

const MAX_VISIBLE_ROWS = 4;
const SEARCH_PLACEHOLDER = 'Search settings…';

function buildRowsForTab(
	tabId: SettingsTabId,
	currentTheme: string,
	currentTitleShape: string,
): SettingRow[] {
	switch (tabId) {
		case 'appearance': {
			return [
				{
					kind: 'managed',
					id: 'theme',
					label: 'Theme',
					value: currentTheme,
					panel: 'theme',
				},
				{
					kind: 'managed',
					id: 'title-shape',
					label: 'Title Shape',
					value: currentTitleShape,
					panel: 'title-shape',
				},
				{
					kind: 'managed',
					id: 'nanocoder-shape',
					label: 'Nanocoder Shape',
					value: getNanocoderShape() ?? 'tiny',
					panel: 'nanocoder-shape',
				},
				{
					kind: 'boolean',
					id: 'alternate-screen',
					label: 'Alternate Screen',
					value: getAlternateScreen(),
					onToggle: () => updateAlternateScreen(!getAlternateScreen()),
				},
			];
		}
		case 'input': {
			const pasteThreshold =
				getPasteThreshold() ?? DEFAULT_SINGLE_LINE_PASTE_THRESHOLD;
			const notifications = getNotificationsPreference();
			return [
				{
					kind: 'number',
					id: 'paste-threshold',
					label: 'Paste Threshold',
					value: pasteThreshold,
					panel: 'paste-threshold',
				},
				{
					kind: 'managed',
					id: 'notifications',
					label: 'Notifications',
					value: notifications?.enabled ? 'on' : 'off',
					panel: 'notifications',
				},
			];
		}
		case 'display':
			return [
				{
					kind: 'managed',
					id: 'display-settings',
					label: 'Tool Results and Thinking',
					value: 'configure',
					panel: 'display-settings',
				},
			];
		case 'advanced':
			return [
				{
					kind: 'managed',
					id: 'privacy',
					label: 'Privacy',
					value: getPrivacyPreference() ? 'on' : 'off',
					panel: 'privacy',
				},
				{
					kind: 'managed',
					id: 'json-config',
					label: 'Config (JSON)',
					value: 'view',
					panel: 'json-config',
				},
			];
	}
}

/**
 * Pure row filter, shared between the render-time `filteredRows` memo and
 * the `handleKey` replay path — the replay reads this from `queryRef`
 * (synchronous) instead of the `query` state (async), see the coalesced-
 * chunk gotcha on `queryRef` below.
 *
 * Ranked like upstream PR 684's "Filter:" box: score each row against both
 * its label and id with `fuzzyScore` (exact=1000 > startsWith=850 >
 * contains=700 > subsequence), keep only score > 0, sort descending with an
 * alphabetical tie-break. Empty query is a no-op — natural tab order.
 */
function filterRows(rows: SettingRow[], query: string): SettingRow[] {
	const q = query.trim();
	if (!q) return rows;
	return rows
		.map(row => ({
			row,
			score: Math.max(fuzzyScore(row.label, q), fuzzyScore(row.id, q)),
		}))
		.filter(({score}) => score > 0)
		.sort((a, b) => {
			if (b.score !== a.score) return b.score - a.score;
			return a.row.label.localeCompare(b.row.label);
		})
		.map(({row}) => row);
}

/**
 * Builds the flat row list for the active tab from the preferences getters.
 * `version` is a manual refresh trigger — bump it after any mutation this
 * hook can't otherwise observe (a managed sub-panel writes preferences.json
 * directly, outside this component's React state).
 */
function useTabRows(tabId: SettingsTabId, version: number): SettingRow[] {
	const {currentTheme} = useTheme();
	const {currentTitleShape} = useTitleShape();

	// biome-ignore lint/correctness/useExhaustiveDependencies: version deliberately drives a full recompute — see doc comment above.
	return useMemo(
		() => buildRowsForTab(tabId, currentTheme, currentTitleShape ?? 'pill'),
		[version, tabId, currentTheme, currentTitleShape],
	);
}

function SettingRowLine({
	row,
	selected,
	labelWidth,
	isNarrow,
}: {
	row: SettingRow;
	selected: boolean;
	labelWidth: number;
	isNarrow: boolean;
}) {
	const {colors} = useTheme();
	const valueText =
		row.kind === 'boolean' ? (row.value ? 'true' : 'false') : String(row.value);
	const rowColor = selected ? colors.info : colors.text;

	return (
		<Box flexDirection="row">
			<Text color={rowColor}>{selected ? '> ' : '  '}</Text>
			<Box width={labelWidth}>
				<Text color={rowColor} wrap={isNarrow ? 'truncate' : undefined}>
					{row.label}
				</Text>
			</Box>
			<Text color={colors.secondary} wrap={isNarrow ? 'truncate' : undefined}>
				{valueText}
			</Text>
		</Box>
	);
}

function renderManagedPanel(
	panel: ManagedSettingsPanel,
	onBack: () => void,
): ReactElement {
	switch (panel) {
		case 'theme':
			return <SettingsThemePanel onBack={onBack} onCancel={onBack} />;
		case 'title-shape':
			return <SettingsTitleShapePanel onBack={onBack} onCancel={onBack} />;
		case 'nanocoder-shape':
			return <SettingsNanocoderShapePanel onBack={onBack} onCancel={onBack} />;
		case 'paste-threshold':
			return <SettingsPasteThresholdPanel onBack={onBack} onCancel={onBack} />;
		case 'notifications':
			return <SettingsNotificationsPanel onBack={onBack} onCancel={onBack} />;
		case 'display-settings':
			return <SettingsDisplayPanel onBack={onBack} onCancel={onBack} />;
		case 'privacy':
			return <SettingsPrivacyPanel onBack={onBack} onCancel={onBack} />;
		case 'json-config':
			return <SettingsJsonConfigPanel onBack={onBack} onCancel={onBack} />;
	}
}

// ---------------------------------------------------------------------------
// Tab shell: outer panel — tab bar, search box, rows, scroll indicator,
// footer hints. Two bordered boxes are on screen while the row list is
// showing: this outer panel, and the search box nested inside it (styled
// after openclaude's SearchBox — see the search box's own comment below).
// When a managed sub-panel is open, it replaces this entire return value
// (its own TitledBoxWithPreferences is the only border on screen at that
// point) — the tab bar and this frame (including the search box) are not
// rendered underneath it.
// ---------------------------------------------------------------------------

type TabFocus = 'header' | 'search' | 'list';

function TabBar({
	activeTab,
	headerFocused,
}: {
	activeTab: SettingsTabId;
	headerFocused: boolean;
}) {
	const {colors} = useTheme();
	const {currentTitleShape} = useTitleShape();
	const shape = currentTitleShape ?? 'pill';

	return (
		<Box
			key={`${activeTab}-${headerFocused}`}
			flexDirection="row"
			gap={1}
			marginBottom={1}
		>
			<Text bold color={colors.primary}>
				Settings
			</Text>
			{TABS.map(tab => {
				const isActive = tab.id === activeTab;
				if (isActive) {
					return (
						<StyledTitle
							key={tab.id}
							title={tab.label}
							shape={shape}
							borderColor={headerFocused ? colors.primary : colors.secondary}
							textColor={colors.base}
						/>
					);
				}
				return <Text key={tab.id}> {tab.label} </Text>;
			})}
		</Box>
	);
}

export function SettingsSelector({onCancel}: SettingsSelectorProps) {
	const {colors} = useTheme();
	const {boxWidth, isNarrow} = useResponsiveTerminal();

	const [activeTab, setActiveTab] = useState<SettingsTabId>('appearance');
	const [focus, setFocus] = useState<TabFocus>('header');
	const [openPanel, setOpenPanel] = useState<ManagedSettingsPanel | null>(null);

	const [version, setVersion] = useState(0);
	const [query, setQuery] = useState('');
	const [selectedIndex, setSelectedIndex] = useState(0);
	const [scrollOffset, setScrollOffset] = useState(0);

	// Ink delivers every keypress event parsed out of one stdin chunk
	// synchronously in the same tick (see ink's `App.handleReadable`), so a
	// down-arrow immediately followed by typed characters (a very ordinary
	// "press down then type" burst, not just paste) can arrive as two
	// separate `useInput` calls before React re-renders between them. The
	// `focus` state read via closure in the second call would still be
	// 'header', silently dropping the keystrokes into the header branch's
	// no-op path. Mirror `focus` into a ref that's written synchronously
	// wherever the state is, and branch on the ref inside the handler so the
	// second event in the same batch sees the first event's transition.
	const focusRef = useRef<TabFocus>(focus);
	const updateFocus = (next: TabFocus) => {
		focusRef.current = next;
		setFocus(next);
	};

	// Same gotcha as focusRef, applied to the search query and selection
	// index: the coalesced-chunk replay in the useInput wrapper below can
	// fire a typed segment (which calls setQuery) immediately followed by
	// one or more synthetic Enter replays in the SAME synchronous batch. The
	// `filteredRows`/`clampedIndex` below are derived from `query`/
	// `selectedIndex` STATE, which hasn't re-rendered yet when the replayed
	// Enters run — so activateRow would read a stale, unfiltered row list
	// (e.g. always index 0) instead of the just-typed filter. Mirror both
	// into refs written synchronously wherever the state is, and have
	// `handleKey` derive its effective rows/index from the refs (via
	// `filterRows`, the same pure helper the render-time memo below uses)
	// instead of closing over the state-derived `filteredRows`/`clampedIndex`.
	const queryRef = useRef(query);
	const updateQuery = (next: string) => {
		queryRef.current = next;
		setQuery(next);
	};
	const selectedIndexRef = useRef(selectedIndex);

	// Switching tabs resets the per-tab search/selection/scroll state and
	// returns focus to the header — the search box always filters within
	// the currently active tab only.
	// biome-ignore lint/correctness/useExhaustiveDependencies: activeTab is the trigger, not read in the body — resets per-tab state whenever the active tab changes.
	useEffect(() => {
		updateQuery('');
		selectedIndexRef.current = 0;
		setSelectedIndex(0);
		setScrollOffset(0);
		updateFocus('header');
	}, [activeTab]);

	const allRows = useTabRows(activeTab, version);
	const filteredRows = useMemo(
		() => filterRows(allRows, query),
		[allRows, query],
	);

	const clampedIndex = Math.min(
		selectedIndex,
		Math.max(0, filteredRows.length - 1),
	);

	// `rowsLength` is passed explicitly by the caller (handleKey) rather than
	// closed over, so a replayed call can pass the ref-derived effective
	// rows length instead of the stale state-derived `filteredRows.length`.
	const moveSelection = (nextIndex: number, rowsLength: number) => {
		const clamped = Math.max(0, Math.min(nextIndex, rowsLength - 1));
		selectedIndexRef.current = clamped;
		setSelectedIndex(clamped);
		setScrollOffset(prevOffset => {
			if (clamped < prevOffset) return clamped;
			if (clamped >= prevOffset + MAX_VISIBLE_ROWS) {
				return clamped - MAX_VISIBLE_ROWS + 1;
			}
			return prevOffset;
		});
	};

	const goToTab = (direction: 1 | -1) => {
		const idx = TABS.findIndex(t => t.id === activeTab);
		const next = TABS[(idx + direction + TABS.length) % TABS.length];
		if (next) setActiveTab(next.id);
	};

	const activateRow = (row: SettingRow) => {
		if (row.kind === 'boolean') {
			row.onToggle();
			setVersion(v => v + 1);
			return;
		}
		setOpenPanel(row.panel);
	};

	// Handles ONE logical keypress (a real key.return, or a synthetic one
	// replayed from a coalesced chunk — see the useInput wrapper below).
	// Reads/branches on focusRef so replayed events in the same synchronous
	// batch see each other's transitions, exactly like the down-arrow +
	// fast-typing case this pattern already handles.
	const handleKey = (
		input: string,
		key: Parameters<Parameters<typeof useInput>[0]>[1],
	) => {
		if (openPanel) {
			// The preserved sub-panel owns input while it's open.
			return;
		}

		if (focusRef.current === 'header') {
			if (key.escape) {
				onCancel();
				return;
			}
			if (key.leftArrow) {
				goToTab(-1);
				return;
			}
			if (key.rightArrow) {
				goToTab(1);
				return;
			}
			if (key.downArrow) {
				updateFocus('search');
			}
			return;
		}

		if (focusRef.current === 'search') {
			if (key.escape) {
				if (queryRef.current.length > 0) {
					updateQuery('');
				} else {
					updateFocus('header');
				}
				return;
			}
			if (key.upArrow) {
				updateFocus('header');
				return;
			}
			if (key.ctrl && input === 'u') {
				// Readline idiom: Ctrl+U clears from cursor to start of line — our
				// cursor is always at the end, so this clears the whole query.
				updateQuery('');
				return;
			}
			if (key.downArrow || key.return) {
				const effectiveRows = filterRows(allRows, queryRef.current);
				if (effectiveRows.length > 0) {
					updateFocus('list');
					moveSelection(0, effectiveRows.length);
				}
				return;
			}
			if (key.backspace || key.delete) {
				updateQuery(queryRef.current.slice(0, -1));
				return;
			}
			if (input && !key.ctrl && !key.meta) {
				updateQuery(queryRef.current + input);
			}
			return;
		}

		// focus === 'list'
		const effectiveRows = filterRows(allRows, queryRef.current);
		const effectiveClampedIndex = Math.min(
			selectedIndexRef.current,
			Math.max(0, effectiveRows.length - 1),
		);

		if (key.escape || input === '/') {
			updateFocus('search');
			return;
		}
		if (key.upArrow) {
			if (effectiveClampedIndex === 0) {
				updateFocus('search');
			} else {
				moveSelection(effectiveClampedIndex - 1, effectiveRows.length);
			}
			return;
		}
		if (key.downArrow) {
			moveSelection(effectiveClampedIndex + 1, effectiveRows.length);
			return;
		}
		if (key.return || input === ' ') {
			const row = effectiveRows[effectiveClampedIndex];
			if (row) activateRow(row);
		}
	};

	useInput(
		(input, key) => {
			// Ink coalesces a run of plain characters immediately followed by
			// one or more Enters — arriving from a real terminal in a single
			// stdin chunk (fast typing capped off with Enter, or a fast
			// double-Enter) — into ONE keypress event: `key.return` is false
			// and `input` is the whole run including the literal `\r`
			// character(s) (e.g. "theme\r" or "theme\r\r", even bare "\r\r").
			// Handled naively, that string falls through to the search box's
			// printable-text branch and gets appended to the query verbatim —
			// the Enter is swallowed, never reaching the select/activate
			// branches at all. Split the run on `\r` and replay each piece
			// through `handleKey` as its own logical keypress: the typed text
			// first, then a synthetic `key.return` event per `\r`. Each
			// replayed call reads/writes `focusRef` synchronously, so a
			// replayed Enter that transitions search -> list is immediately
			// visible to the next replayed Enter in the same batch — the same
			// mechanism that already keeps down-arrow + fast-typing in sync.
			if (!key.return && input.includes('\r')) {
				const segments = input.split('\r');
				segments.forEach((segment, i) => {
					if (segment) handleKey(segment, {...key, return: false});
					if (i < segments.length - 1) handleKey('', {...key, return: true});
				});
				return;
			}
			handleKey(input, key);
		},
		{isActive: true},
	);

	if (openPanel) {
		const onBack = () => {
			setVersion(v => v + 1);
			setOpenPanel(null);
		};
		return renderManagedPanel(openPanel, onBack);
	}

	const width = isNarrow ? '100%' : boxWidth;
	const labelWidth = Math.min(44, Math.max(18, Math.floor(boxWidth * 0.5)));
	const visibleRows = filteredRows.slice(
		scrollOffset,
		scrollOffset + MAX_VISIBLE_ROWS,
	);
	const moreAbove = scrollOffset;
	const moreBelow = Math.max(
		0,
		filteredRows.length - scrollOffset - MAX_VISIBLE_ROWS,
	);

	const footerHint =
		focus === 'header'
			? '←/→ tabs · ↓ enter · Esc close'
			: focus === 'search'
				? 'Type to filter · Enter/↓ select · ^U clear · ↑ tabs · Esc clear'
				: 'Enter change · / search · Esc back';

	return (
		<Box
			flexDirection="column"
			borderStyle="round"
			borderColor={colors.primary}
			paddingX={isNarrow ? 1 : 2}
			paddingY={1}
			width={width}
			marginBottom={1}
		>
			<TabBar activeTab={activeTab} headerFocused={focus === 'header'} />

			{/*
			 * Search box: rounded-border row matching openclaude's SearchBox
			 * (src/components/SearchBox.tsx) — magnifier prefix, border color
			 * keyed on focus (focused: colors.info, undimmed; unfocused:
			 * colors.secondary, dimmed via borderDimColor, mirroring
			 * openclaude's `borderColor={isFocused ? "suggestion" : undefined}` /
			 * `borderDimColor={!isFocused}`). No explicit width: like
			 * openclaude's SearchBox, this Box relies on the parent column
			 * flex container's default `alignItems: stretch` to fill the full
			 * interior width — the row list below is a sibling Box with its
			 * own independent width, unaffected by this border/padding.
			 */}
			<Box
				flexShrink={0}
				borderStyle="round"
				borderColor={focus === 'search' ? colors.info : colors.secondary}
				borderDimColor={focus !== 'search'}
				paddingX={1}
			>
				<Text color={colors.secondary}>{'⌕ '}</Text>
				{focus === 'search' ? (
					<Text>
						{query.length === 0
							? // Empty query: the placeholder itself carries the cursor —
								// its first character renders inverse-video, mirroring
								// text-input.tsx's `renderedPlaceholder` idiom exactly.
								chalk.inverse(SEARCH_PLACEHOLDER[0]) +
								chalk.hex(colors.info)(SEARCH_PLACEHOLDER.slice(1)) +
								' '
							: // Non-empty query: HTML-placeholder semantics — the
								// placeholder text disappears entirely once typing
								// starts (matches openclaude's SearchBox and this
								// file's own text-input.tsx placeholder idiom). The
								// cursor is always at the end (this row has no
								// interior cursor movement), so append an
								// inverse-video space — text-input.tsx's
								// `cursorOffset === value.length` end-of-value cursor.
								query + chalk.inverse(' ')}
					</Text>
				) : (
					<>
						{query.length === 0 ? (
							<Text color={colors.secondary}>{SEARCH_PLACEHOLDER} </Text>
						) : (
							<Text color={colors.text}>{query}</Text>
						)}
					</>
				)}
			</Box>
			<Box marginTop={1} flexDirection="column">
				{moreAbove > 0 && (
					<Text color={colors.secondary} dimColor>
						↑ {moreAbove} more above
					</Text>
				)}
				{visibleRows.length === 0 && (
					<Text color={colors.secondary}>No settings match "{query}"</Text>
				)}
				{visibleRows.map((row, i) => (
					<SettingRowLine
						key={row.id}
						row={row}
						selected={focus === 'list' && scrollOffset + i === clampedIndex}
						labelWidth={labelWidth}
						isNarrow={isNarrow}
					/>
				))}
				{moreBelow > 0 && (
					<Text color={colors.secondary} dimColor>
						↓ {moreBelow} more below
					</Text>
				)}
			</Box>

			<Box marginTop={1}>
				<Text color={colors.secondary}>{footerHint}</Text>
			</Box>
		</Box>
	);
}
