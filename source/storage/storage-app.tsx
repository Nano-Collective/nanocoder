import {Box, Text, useApp, useInput, useStdout} from 'ink';
import {useEffect, useState} from 'react';
import type {
	StorageFinding,
	StorageItem,
	StorageReport,
	StorageSection,
} from './diagnostics.js';

const sectionNames = [
	'sessions',
	'artifacts',
	'timeline',
	'checkpoints',
] as const;
type SectionName = (typeof sectionNames)[number];
type Focus = 'stores' | 'entries' | 'detail';

function size(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	const units = ['KiB', 'MiB', 'GiB', 'TiB'];
	let value = bytes;
	let unit = -1;
	do {
		value /= 1024;
		unit++;
	} while (value >= 1024 && unit < units.length - 1);
	return `${value.toFixed(1)} ${units[unit]}`;
}

/** Ink's stdout, not process.stdout, is the surface used by the renderer. */
function useViewport() {
	const {stdout} = useStdout();
	const [viewport, setViewport] = useState(() => ({
		columns: stdout.columns || 80,
		rows: stdout.rows || 24,
	}));
	useEffect(() => {
		const resize = () =>
			setViewport({columns: stdout.columns || 80, rows: stdout.rows || 24});
		stdout.on('resize', resize);
		resize();
		return () => {
			stdout.off('resize', resize);
		};
	}, [stdout]);
	return viewport;
}

function EntryDetails({
	entry,
}: {
	entry:
		| {kind: 'item'; data: StorageItem}
		| {kind: 'finding'; data: StorageFinding};
}) {
	if (entry.kind === 'finding') {
		const finding = entry.data;
		return (
			<>
				<Text bold wrap="truncate-end">
					Finding · {finding.code}
				</Text>
				<Text>Severity: {finding.severity}</Text>
				<Text wrap="truncate-end">{finding.message}</Text>
				{finding.path && <Text wrap="truncate-end">Path: {finding.path}</Text>}
			</>
		);
	}
	const item = entry.data;
	return (
		<>
			<Text bold wrap="truncate-end">
				Item · {item.name}
			</Text>
			<Text wrap="truncate-end">Path: {item.path}</Text>
			<Text>Status: {item.status}</Text>
			<Text>
				Size: {size(item.sizeBytes)} ({item.sizeBytes} bytes)
			</Text>
			{item.modifiedAt && <Text>Modified: {item.modifiedAt}</Text>}
			{item.ageDays !== undefined && <Text>Age: {item.ageDays} days</Text>}
			{item.detail && <Text wrap="truncate-end">Detail: {item.detail}</Text>}
		</>
	);
}

export function StorageApp({report}: {report: StorageReport}) {
	const {exit} = useApp();
	const {columns, rows} = useViewport();
	const [sectionIndex, setSectionIndex] = useState(0);
	const [entryIndex, setEntryIndex] = useState(0);
	const [focus, setFocus] = useState<Focus>('stores');
	const name: SectionName = sectionNames[sectionIndex];
	const active: StorageSection = report.sections[name];
	const entries: Array<
		{kind: 'item'; data: StorageItem} | {kind: 'finding'; data: StorageFinding}
	> = [
		...active.items.map(data => ({kind: 'item' as const, data})),
		...active.findings.map(data => ({kind: 'finding' as const, data})),
	];
	const compact = columns < 72;
	const short = rows < 18;
	const tiny = columns < 40 || rows < 14;
	const visibleCount = Math.max(
		1,
		Math.min(12, rows - (compact ? 19 : 17) - (active.limits?.length ?? 0)),
	);
	const selectedEntry = Math.min(entryIndex, Math.max(0, entries.length - 1));
	const firstVisible = Math.min(
		Math.max(0, selectedEntry - Math.floor(visibleCount / 2)),
		Math.max(0, entries.length - visibleCount),
	);
	const visibleEntries = entries.slice(
		firstVisible,
		firstVisible + visibleCount,
	);

	useInput((input, key) => {
		if ((key.ctrl && input === 'c') || input === 'q') {
			exit();
			return;
		}
		if (key.escape || key.leftArrow) {
			if (focus === 'detail') setFocus('entries');
			else if (focus === 'entries') setFocus('stores');
			else if (key.escape) exit();
			return;
		}
		if (focus === 'detail') return;
		if (key.upArrow || key.downArrow) {
			const delta = key.downArrow ? 1 : -1;
			if (focus === 'stores') {
				setSectionIndex(index =>
					Math.max(0, Math.min(sectionNames.length - 1, index + delta)),
				);
				setEntryIndex(0);
			} else {
				setEntryIndex(index =>
					Math.max(0, Math.min(entries.length - 1, index + delta)),
				);
			}
		} else if (key.return || key.rightArrow) {
			if (focus === 'stores' && entries.length > 0) setFocus('entries');
			else if (focus === 'entries' && entries.length > 0) setFocus('detail');
		}
	});

	const footer =
		focus === 'detail'
			? 'Esc Back   q Quit'
			: focus === 'entries'
				? '↑↓ Select   Enter Details   Esc Stores   q Quit'
				: '↑↓ Select   Enter Explore   Esc Exit   q Quit';
	const bodyHeight = Math.max(1, rows - (short ? 5 : 7));
	const sidebarWidth = Math.min(32, Math.max(24, Math.floor(columns * 0.33)));
	const storeList = (
		<Box
			flexDirection="column"
			width={compact ? undefined : sidebarWidth}
			borderStyle={compact ? undefined : 'single'}
			borderTop={false}
			borderBottom={false}
			borderLeft={false}
			borderRight={!compact}
			paddingX={1}
		>
			<Text bold>Stores</Text>
			{sectionNames.map((section, index) => {
				const data = report.sections[section];
				const selected = index === sectionIndex;
				return (
					<Text
						key={section}
						color={selected ? 'cyan' : undefined}
						bold={selected && focus === 'stores'}
						wrap="truncate-end"
					>
						{selected ? '❯' : ' '} {section} · {size(data.sizeBytes)}
						{data.findings.length > 0 ? ` · !${data.findings.length}` : ''}
					</Text>
				);
			})}
		</Box>
	);
	const detail = (
		<Box flexDirection="column" flexGrow={1} paddingX={1}>
			<Text bold wrap="truncate-end">
				{name[0].toUpperCase() + name.slice(1)} [{active.scope}] ·{' '}
				{active.count} items · {active.findings.length} findings
			</Text>
			<Text wrap="truncate-end">Root: {active.root}</Text>
			{!short && (
				<>
					{active.limits?.map(limit => (
						<Text key={limit.label} dimColor wrap="truncate-end">
							{limit.label}: {limit.value}
						</Text>
					))}
					<Text> </Text>
				</>
			)}
			{focus === 'detail' && entries[selectedEntry] ? (
				<EntryDetails entry={entries[selectedEntry]} />
			) : (
				<>
					<Text bold>Entries</Text>
					{entries.length === 0 && <Text dimColor>No {name} found.</Text>}
					{visibleEntries.map((entry, index) => {
						const selected = firstVisible + index === selectedEntry;
						const label =
							entry.kind === 'item'
								? `ITEM ${entry.data.name} · ${entry.data.status} · ${size(entry.data.sizeBytes)}`
								: `FINDING ${entry.data.severity}: ${entry.data.message}`;
						return (
							<Text
								key={`${entry.kind}-${firstVisible + index}`}
								color={selected && focus === 'entries' ? 'cyan' : undefined}
								wrap="truncate-end"
							>
								{selected && focus === 'entries' ? '❯' : ' '} {label}
							</Text>
						);
					})}
					{entries.length > visibleCount && (
						<Text dimColor>
							Showing {firstVisible + 1}-{firstVisible + visibleEntries.length}{' '}
							of {entries.length}
						</Text>
					)}
				</>
			)}
		</Box>
	);

	if (tiny) {
		return (
			<Box width={columns} height={rows} flexDirection="column">
				<Text wrap="truncate-end">
					Storage view needs 40 columns and 14 rows.
				</Text>
				<Text wrap="truncate-end">Resize the terminal or press q to quit.</Text>
			</Box>
		);
	}

	return (
		<Box
			width={columns}
			height={rows}
			borderStyle="round"
			flexDirection="column"
		>
			<Box justifyContent="space-between" paddingX={1}>
				<Text bold wrap="truncate-end">
					Nanocoder storage
				</Text>
				<Text color="cyan">READ-ONLY</Text>
			</Box>
			{!short && (
				<Text wrap="truncate-end"> Project: {report.projectRoot}</Text>
			)}
			<Text dimColor>{'─'.repeat(Math.max(1, columns - 2))}</Text>
			<Box
				flexDirection={compact ? 'column' : 'row'}
				height={bodyHeight}
				flexGrow={1}
			>
				{(!short || focus === 'stores') && storeList}
				{!short && compact && (
					<Text dimColor>{'─'.repeat(Math.max(1, columns - 2))}</Text>
				)}
				{(!short || focus !== 'stores') && detail}
			</Box>
			<Text dimColor>{'─'.repeat(Math.max(1, columns - 2))}</Text>
			<Text wrap="truncate-end"> {footer}</Text>
		</Box>
	);
}
