import {Box, Text, useApp, useInput} from 'ink';
import {useState} from 'react';
import {useTerminalRows} from '@/hooks/useTerminalWidth';
import type {StorageReport, StorageSection} from './diagnostics.js';

const sectionNames = [
	'sessions',
	'artifacts',
	'timeline',
	'checkpoints',
] as const;
type SectionName = (typeof sectionNames)[number];
type Selection = {kind: 'item' | 'finding'; index: number};

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

export function StorageApp({report}: {report: StorageReport}) {
	const {exit} = useApp();
	const rows = useTerminalRows();
	const [section, setSection] = useState<SectionName | undefined>();
	const [sectionIndex, setSectionIndex] = useState(0);
	const [entryIndex, setEntryIndex] = useState(0);
	const [selection, setSelection] = useState<Selection | undefined>();
	const active: StorageSection | undefined = section
		? report.sections[section]
		: undefined;
	const entryCount = active ? active.items.length + active.findings.length : 0;
	const visibleCount = Math.max(1, Math.min(12, rows - 14));
	const firstVisible = Math.min(
		Math.max(0, entryIndex - Math.floor(visibleCount / 2)),
		Math.max(0, entryCount - visibleCount),
	);
	const visibleEntries = active
		? [
				...active.items.map((item, index) => ({
					kind: 'item' as const,
					index,
					key: item.path,
					label: `ITEM ${item.name} · ${item.status} · ${size(item.sizeBytes)}`,
				})),
				...active.findings.map((issue, index) => ({
					kind: 'finding' as const,
					index,
					key: `${issue.code}-${index}`,
					label: `FINDING ${issue.severity}: ${issue.message}`,
				})),
			].slice(firstVisible, firstVisible + visibleCount)
		: [];

	useInput((input, key) => {
		if ((key.ctrl && input === 'c') || input === 'q') {
			exit();
			return;
		}
		if (key.escape) {
			if (selection) setSelection(undefined);
			else if (section) setSection(undefined);
			else exit();
			return;
		}
		if (selection) return;
		if (key.upArrow || key.downArrow) {
			const delta = key.downArrow ? 1 : -1;
			if (section)
				setEntryIndex(index =>
					Math.max(0, Math.min(entryCount - 1, index + delta)),
				);
			else
				setSectionIndex(index =>
					Math.max(0, Math.min(sectionNames.length - 1, index + delta)),
				);
		} else if (key.return) {
			if (!section) {
				setSection(sectionNames[sectionIndex]);
				setEntryIndex(0);
			} else if (active && entryCount > 0) {
				setSelection(
					entryIndex < active.items.length
						? {kind: 'item', index: entryIndex}
						: {kind: 'finding', index: entryIndex - active.items.length},
				);
			}
		}
	});

	return (
		<Box flexDirection="column">
			<Text bold>Storage diagnostics · read-only</Text>
			<Text wrap="truncate-end">Project: {report.projectRoot}</Text>
			<Text>Scanned: {report.scannedAt}</Text>
			<Text> </Text>
			{!section ? (
				<>
					<Text bold>Overview · select a section</Text>
					{sectionNames.map((name, index) => {
						const data = report.sections[name];
						return (
							<Text
								key={name}
								color={index === sectionIndex ? 'cyan' : undefined}
								wrap="truncate-end"
							>
								{index === sectionIndex ? '❯' : ' '} {name} [{data.scope}] ·{' '}
								{data.count} items · {size(data.sizeBytes)} ·{' '}
								{data.findings.length} findings
							</Text>
						);
					})}
					<Text> </Text>
					<Text wrap="truncate-end">
						Root: {report.sections[sectionNames[sectionIndex]].root}
					</Text>
				</>
			) : (
				active && (
					<>
						<Text bold>
							{section} [{active.scope}] · {active.count} items ·{' '}
							{size(active.sizeBytes)}
						</Text>
						<Text wrap="truncate-end">Root: {active.root}</Text>
						{active.limits?.map((limit, index) => (
							<Text key={`${limit.label}-${index}`}>
								Limit · {limit.label}: {limit.value}
							</Text>
						))}
						<Text> </Text>
						{selection ? (
							selection.kind === 'item' ? (
								(() => {
									const item = active.items[selection.index];
									return (
										<>
											<Text bold>Item · {item.name}</Text>
											<Text wrap="truncate-end">Path: {item.path}</Text>
											<Text>Status: {item.status}</Text>
											<Text>
												Size: {size(item.sizeBytes)} ({item.sizeBytes} bytes)
											</Text>
											{item.modifiedAt && (
												<Text>Modified: {item.modifiedAt}</Text>
											)}
											{item.ageDays !== undefined && (
												<Text>Age: {item.ageDays} days</Text>
											)}
											{item.detail && (
												<Text wrap="truncate-end">Detail: {item.detail}</Text>
											)}
										</>
									);
								})()
							) : (
								(() => {
									const finding = active.findings[selection.index];
									return (
										<>
											<Text bold>Finding · {finding.code}</Text>
											<Text>Severity: {finding.severity}</Text>
											<Text wrap="truncate-end">{finding.message}</Text>
											{finding.path && (
												<Text wrap="truncate-end">Path: {finding.path}</Text>
											)}
										</>
									);
								})()
							)
						) : (
							<>
								<Text bold>
									Entries · {active.items.length} items ·{' '}
									{active.findings.length} findings
								</Text>
								{entryCount === 0 && <Text> None</Text>}
								{visibleEntries.map((entry, index) => (
									<Text
										key={`${entry.kind}-${entry.key}-${entry.index}`}
										wrap="truncate-end"
										color={
											entryIndex === firstVisible + index ? 'cyan' : undefined
										}
									>
										{entryIndex === firstVisible + index ? '❯' : ' '}{' '}
										{entry.label}
									</Text>
								))}
								{entryCount > visibleCount && (
									<Text dimColor>
										Showing {firstVisible + 1}-
										{firstVisible + visibleEntries.length} of {entryCount}
									</Text>
								)}
							</>
						)}
					</>
				)
			)}
			<Text> </Text>
			<Text dimColor wrap="truncate-end">
				{!section
					? '↑/↓ select · Enter open · Esc exit'
					: selection
						? 'Esc back'
						: '↑/↓ select · Enter open · Esc back'}{' '}
				· q / Ctrl+C exit · read-only
			</Text>
		</Box>
	);
}
