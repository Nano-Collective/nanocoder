import {Box, Text, useInput} from 'ink';
import Spinner from 'ink-spinner';
import {useTheme} from '@/hooks/useTheme';
import type {SwarmConfig, SwarmSnapshot, WorkerState} from '@/swarm/types';

const MAX_LISTED_FILES = 8;

export function SwarmDashboard({
	config,
	snapshot,
	onCancel,
	onConfirm,
}: {
	config: SwarmConfig;
	snapshot: SwarmSnapshot;
	onCancel: () => void;
	onConfirm: (apply: boolean) => void;
}) {
	const {colors} = useTheme();
	const awaiting = snapshot.status === 'awaiting-confirmation';

	useInput((input, key) => {
		if (key.ctrl && input === 'c') {
			onCancel();
		} else if (awaiting && input.toLowerCase() === 'y') {
			onConfirm(true);
		} else if (awaiting && (input.toLowerCase() === 'n' || key.escape)) {
			onConfirm(false);
		}
	});

	const files = snapshot.patches.flatMap(patch => patch.files);

	return (
		<Box
			flexDirection="column"
			paddingX={1}
			borderStyle="round"
			borderColor={colors.primary}
		>
			<Text bold color={colors.primary}>
				Nanocoder Swarm
			</Text>
			<Text color={colors.secondary}>
				Mode: <Text color={colors.text}>{config.swarmMode}</Text>
				{'  '}Status:{' '}
				<Text
					color={
						snapshot.status === 'complete'
							? colors.success
							: snapshot.status === 'failed'
								? colors.error
								: colors.info
					}
				>
					{snapshot.status}
				</Text>
			</Text>

			<Box flexDirection="column" marginTop={1}>
				{snapshot.workers.map(worker => (
					<WorkerRow key={worker.id} worker={worker} />
				))}
			</Box>

			{awaiting && (
				<Box flexDirection="column" marginTop={1}>
					{files.slice(0, MAX_LISTED_FILES).map(file => (
						<Text key={file} color={colors.text}>
							{'  '}
							{file}
						</Text>
					))}
					{files.length > MAX_LISTED_FILES && (
						<Text color={colors.secondary}>
							{'  '}and {files.length - MAX_LISTED_FILES} more
						</Text>
					)}
					<Text color={colors.warning}>
						Review the patches in {snapshot.runDir}, then apply these changes?
						(y/n)
					</Text>
				</Box>
			)}
			{snapshot.status !== 'complete' && snapshot.status !== 'failed' && (
				<Text color={colors.secondary}>Press Ctrl+C to cancel.</Text>
			)}
		</Box>
	);
}

function WorkerRow({worker}: {worker: WorkerState}) {
	const {colors} = useTheme();
	const color =
		worker.status === 'success'
			? colors.success
			: worker.status === 'failed'
				? colors.error
				: colors.text;

	return (
		<Box gap={1}>
			<Box width={2} flexShrink={0}>
				{worker.status === 'running' ? (
					<Text color={colors.info}>
						<Spinner type="dots" />
					</Text>
				) : (
					<Text color={color}>
						{worker.status === 'success'
							? '✓'
							: worker.status === 'failed'
								? '✗'
								: '-'}
					</Text>
				)}
			</Box>
			<Box width={22} flexShrink={0}>
				<Text bold color={color} wrap="truncate">
					{worker.id}
				</Text>
			</Box>
			<Box width={10} flexShrink={0}>
				<Text color={color}>{worker.status}</Text>
			</Box>
			<Box flexGrow={1}>
				<Text color={colors.secondary} wrap="truncate">
					{worker.currentTool ?? worker.fileScope.join(', ')}
				</Text>
			</Box>
			<Box flexShrink={0}>
				<Text color={colors.secondary}>
					{worker.status === 'success'
						? `${worker.tokens} tokens`
						: `turn ${worker.turns}`}
				</Text>
			</Box>
		</Box>
	);
}
