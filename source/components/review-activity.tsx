import {Box, Text, useInput} from 'ink';
import {useEffect, useReducer, useRef, useState} from 'react';
import {useTheme} from '@/hooks/useTheme';
import type {
	ReviewActivityEvent,
	ReviewActivityStore,
} from '@/review/review-activity';

export interface ReviewActivityProps {
	store: ReviewActivityStore;
	onCancel?: () => void;
	interactive?: boolean;
}

function elapsedLabel(durationMs: number | undefined): string {
	if (durationMs === undefined) return 'running';
	if (durationMs < 1000) return `${durationMs}ms`;
	return `${(durationMs / 1000).toFixed(1)}s`;
}

function statusLabel(event: ReviewActivityEvent): string {
	return `${event.status} · ${elapsedLabel(event.durationMs)}`;
}

function latestSummary(event: ReviewActivityEvent): string {
	return event.updates[event.updates.length - 1]?.summary ?? event.name;
}

export function ReviewActivity({
	store,
	onCancel,
	interactive = false,
}: ReviewActivityProps): React.ReactElement {
	const {colors} = useTheme();
	const [, forceRender] = useReducer((value: number) => value + 1, 0);
	const [expanded, setExpanded] = useState(false);
	const cancelRequested = useRef(false);

	useEffect(() => {
		cancelRequested.current = false;
		return store.subscribe(forceRender);
	}, [store]);

	useInput(
		(input, key) => {
			if (input === 'd' || input === 'D') {
				setExpanded(value => !value);
				return;
			}
			if (
				key.escape &&
				store.getStatus() === 'running' &&
				onCancel &&
				!cancelRequested.current
			) {
				cancelRequested.current = true;
				onCancel();
			}
		},
		{isActive: interactive},
	);

	const summary = store.toSummary();
	const recentEvents = summary.events.slice(-3);
	const events = expanded ? summary.events : recentEvents;
	const running = summary.status === 'running';
	const statusColor =
		summary.status === 'completed'
			? colors.success
			: summary.status === 'failed'
				? colors.error
				: summary.status === 'cancelled'
					? colors.warning
					: colors.primary;

	return (
		<Box flexDirection="column" marginBottom={1}>
			<Box>
				<Text color={colors.secondary}>Review foundation · </Text>
				<Text color={statusColor}>{summary.status}</Text>
				{summary.droppedEventCount > 0 && (
					<Text color={colors.secondary}>
						{' '}
						· {summary.droppedEventCount} earlier steps omitted
					</Text>
				)}
			</Box>

			{events.map(event => (
				<Box key={event.id} flexDirection="column" marginLeft={2}>
					<Box>
						<Text color={colors.secondary}>
							{event.source}: {event.name}
						</Text>
						<Text color={colors.secondary}> — {statusLabel(event)}</Text>
					</Box>
					<Text color={colors.primary}>{latestSummary(event)}</Text>
					{expanded && event.safeArgs && (
						<Text color={colors.secondary}>
							args: {event.safeArgs.join(' ')}
						</Text>
					)}
					{expanded &&
						event.updates.length > 1 &&
						event.updates.slice(0, -1).map((update, index) => (
							<Text
								key={`${event.id}:update:${index}`}
								color={colors.secondary}
							>
								{new Date(update.at).toLocaleTimeString()} · {update.summary}
							</Text>
						))}
					{expanded && event.error && (
						<Text color={colors.error}>Error: {event.error}</Text>
					)}
				</Box>
			))}

			<Text color={colors.secondary} dimColor>
				{interactive
					? running
						? `D details${onCancel ? ' · Esc cancel' : ''}`
						: 'D details'
					: ''}
			</Text>
		</Box>
	);
}
