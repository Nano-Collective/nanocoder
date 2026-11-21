import {Box, Text} from 'ink';
import {useTerminalWidth} from '@/hooks/useTerminalWidth';
import {useTheme} from '@/hooks/useTheme';
import {
	computePlanStats,
	getReadyNodes,
	getWaitingNodes,
	orderPlanNodes,
} from '@/plans/graph';
import type {
	PlanGraph,
	PlanNode,
	PlanNodeStatus,
	PlanSummary,
} from '@/plans/types';

const STATUS_ICONS: Record<PlanNodeStatus, string> = {
	todo: '○',
	doing: '◐',
	done: '✓',
	blocked: '!',
};

function statusColor(
	status: PlanNodeStatus,
	colors: ReturnType<typeof useTheme>['colors'],
): string {
	switch (status) {
		case 'done':
			return colors.success;
		case 'doing':
			return colors.warning;
		case 'blocked':
			return colors.error;
		default:
			return colors.secondary;
	}
}

interface PlanGraphDisplayProps {
	plan: PlanGraph;
	/** True when this plan receives the per-turn context. */
	isActive?: boolean;
	message?: string;
}

export function PlanGraphDisplay({
	plan,
	isActive = false,
	message,
}: PlanGraphDisplayProps) {
	const boxWidth = useTerminalWidth();
	const {colors} = useTheme();
	const stats = computePlanStats(plan.nodes);
	const ready = getReadyNodes(plan.nodes);
	const waiting = getWaitingNodes(plan.nodes);
	const blocked = plan.nodes.filter(node => node.status === 'blocked');
	const ordered = orderPlanNodes(plan.nodes);

	return (
		<Box flexDirection="column" marginY={1} width={boxWidth}>
			{message && (
				<Box marginBottom={1}>
					<Text color={colors.success}>{message}</Text>
				</Box>
			)}
			<Box>
				<Text bold color={colors.primary}>
					{plan.title}
				</Text>
				<Text color={colors.secondary}>
					{'  '}
					{stats.done}/{stats.total} done
					{stats.doing > 0 ? ` · ${stats.doing} doing` : ''}
					{stats.blocked > 0 ? ` · ${stats.blocked} blocked` : ''}
					{isActive ? ' · active' : ''}
				</Text>
			</Box>
			<Box>
				<Text color={colors.secondary}>id: {plan.id}</Text>
			</Box>

			{ready.length > 0 && (
				<Box marginTop={1}>
					<Text color={colors.text}>
						Ready now:{' '}
						<Text color={colors.success}>
							{ready.map(node => node.id).join(', ')}
						</Text>
					</Text>
				</Box>
			)}
			{blocked.length > 0 && (
				<Box>
					<Text color={colors.text}>
						Blocked:{' '}
						<Text color={colors.error}>
							{blocked
								.map(
									node =>
										`${node.id}${node.blockedReason ? ` (${node.blockedReason})` : ''}`,
								)
								.join(', ')}
						</Text>
					</Text>
				</Box>
			)}
			{waiting.length > 0 && (
				<Box>
					<Text color={colors.secondary}>
						Waiting on dependencies: {waiting.map(node => node.id).join(', ')}
					</Text>
				</Box>
			)}

			<Box flexDirection="column" marginTop={1}>
				{ordered.map(node => (
					<PlanNodeRow
						key={node.id}
						node={node}
						color={statusColor(node.status, colors)}
						secondaryColor={colors.secondary}
						textColor={colors.text}
					/>
				))}
			</Box>
		</Box>
	);
}

function PlanNodeRow({
	node,
	color,
	secondaryColor,
	textColor,
}: {
	node: PlanNode;
	color: string;
	secondaryColor: string;
	textColor: string;
}) {
	const annotations: string[] = [];
	if (node.agent) annotations.push(`agent: ${node.agent}`);
	if (node.checkpoint) annotations.push(`checkpoint: ${node.checkpoint}`);
	if (node.status === 'blocked' && node.blockedReason) {
		annotations.push(`blocked: ${node.blockedReason}`);
	}
	if (node.status === 'todo' && node.dependsOn.length > 0) {
		annotations.push(`after: ${node.dependsOn.join(', ')}`);
	}

	return (
		<Box flexDirection="row">
			<Box width={2}>
				<Text color={color}>{STATUS_ICONS[node.status]}</Text>
			</Box>
			<Box flexShrink={0} marginRight={1}>
				<Text color={secondaryColor}>{node.id}</Text>
			</Box>
			<Box flexShrink={1}>
				<Text
					wrap="truncate-end"
					color={node.status === 'done' ? secondaryColor : textColor}
				>
					{node.title}
					{annotations.length > 0 ? (
						<Text color={secondaryColor}>
							{'  '}({annotations.join(' · ')})
						</Text>
					) : null}
				</Text>
			</Box>
		</Box>
	);
}

interface PlanListDisplayProps {
	plans: PlanSummary[];
	activePlanId: string | null;
	message?: string;
}

export function PlanListDisplay({
	plans,
	activePlanId,
	message,
}: PlanListDisplayProps) {
	const boxWidth = useTerminalWidth();
	const {colors} = useTheme();

	return (
		<Box flexDirection="column" marginY={1} width={boxWidth}>
			{message && (
				<Box marginBottom={1}>
					<Text color={colors.success}>{message}</Text>
				</Box>
			)}
			{plans.length === 0 ? (
				<Text color={colors.secondary}>
					No plan graphs yet. Ask for a plan in plan mode, or have the AI call
					write_plan with nodes.
				</Text>
			) : (
				<>
					<Text bold color={colors.primary}>
						Plan graphs
					</Text>
					{plans.map(plan => (
						<Box key={plan.id} flexDirection="row">
							<Box width={2}>
								<Text
									color={
										plan.id === activePlanId ? colors.success : colors.secondary
									}
								>
									{plan.id === activePlanId ? '●' : '○'}
								</Text>
							</Box>
							<Box flexShrink={0} marginRight={1}>
								<Text color={colors.secondary}>{plan.id}</Text>
							</Box>
							<Box flexShrink={1}>
								<Text wrap="truncate-end">
									{plan.title}
									<Text color={colors.secondary}>
										{'  '}
										{plan.done}/{plan.total} done
										{plan.blocked > 0 ? ` · ${plan.blocked} blocked` : ''}
									</Text>
								</Text>
							</Box>
						</Box>
					))}
					<Box marginTop={1}>
						<Text color={colors.secondary}>
							/plans show [id] · /plans use &lt;id&gt; · /plans delete
							&lt;id&gt;
						</Text>
					</Box>
				</>
			)}
		</Box>
	);
}
