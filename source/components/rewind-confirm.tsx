import {Box, Text} from 'ink';
import {FilterableSelectList} from '@/components/filterable-select-list';
import type {ItemSelectorOption} from '@/components/item-selector';
import {TitledBoxWithPreferences} from '@/components/ui/titled-box';
import {useTerminalWidth} from '@/hooks/useTerminalWidth';
import {useTheme} from '@/hooks/useTheme';
import {promptTitle, type RewindPoint} from '@/services/rewind';
import type {TimelineRevertPlan} from '@/types/timeline';

interface RewindConfirmProps {
	point: RewindPoint;
	plan: TimelineRevertPlan;
	onConfirm: () => void;
	onCancel: () => void;
}

const MAX_LISTED_FILES = 12;

function FileList({
	title,
	paths,
	color,
}: {
	title: string;
	paths: string[];
	color: string;
}) {
	if (paths.length === 0) return null;
	const shown = paths.slice(0, MAX_LISTED_FILES);
	const hidden = paths.length - shown.length;
	return (
		<Box flexDirection="column">
			<Text color={color}>
				{title} ({paths.length})
			</Text>
			{shown.map(path => (
				<Text key={`${title}-${path}`} color={color}>
					{'  '}
					{path}
				</Text>
			))}
			{hidden > 0 ? (
				<Text color={color}>
					{'  '}…and {hidden} more
				</Text>
			) : null}
		</Box>
	);
}

/**
 * The last step before `/rewind` writes anything: the exact files that will be
 * overwritten or deleted, and a yes/no choice. Restoring a turn's files in bulk
 * is destructive, so the list is shown first rather than only in the summary.
 */
export default function RewindConfirm({
	point,
	plan,
	onConfirm,
	onCancel,
}: RewindConfirmProps) {
	const boxWidth = useTerminalWidth();
	const {colors} = useTheme();

	const options: ItemSelectorOption[] = [
		{
			label: `Restore ${plan.restore.length + plan.remove.length} file(s)`,
			value: 'confirm',
			searchText: 'confirm restore',
		},
		{
			label: 'Cancel',
			value: 'cancel',
			searchText: 'cancel',
		},
	];

	return (
		<TitledBoxWithPreferences
			title="Rewind - Confirm Files"
			width={boxWidth}
			borderColor={colors.warning}
			paddingX={2}
			paddingY={1}
			marginBottom={1}
		>
			<Box flexDirection="column">
				<Box marginBottom={1} flexDirection="column">
					<Text color={colors.secondary}>
						Prompt:{' '}
						<Text color={colors.text}>
							{promptTitle(point.promptText) || '(empty prompt)'}
						</Text>
					</Text>
					<Text color={colors.warning}>
						These workspace changes will be overwritten or deleted.
					</Text>
				</Box>

				<FileList
					title="Restore to their before-image"
					paths={plan.restore}
					color={colors.secondary}
				/>
				<FileList
					title="Delete (created by the agent)"
					paths={plan.remove}
					color={colors.error}
				/>

				<Box marginTop={1}>
					<FilterableSelectList
						items={options}
						onSelect={value => (value === 'confirm' ? onConfirm() : onCancel())}
						onCancel={onCancel}
						visibleCount={2}
					/>
				</Box>

				<Box marginTop={1}>
					<Text color={colors.secondary}>
						↑/↓ to choose • Enter to confirm • Esc to cancel
					</Text>
				</Box>
			</Box>
		</TitledBoxWithPreferences>
	);
}
