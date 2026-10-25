import {Box, Text} from 'ink';
import React from 'react';
import {
	PlanGraphDisplay,
	PlanListDisplay,
} from '@/components/plan-graph-display';
import {useTheme} from '@/hooks/useTheme';
import {PlanStore, PlanStoreError} from '@/plans/storage';
import {generateKey} from '@/session/key-generator';
import type {Command} from '@/types/index';

const USAGE = 'Usage: /plans [list|show [id]|use <id|none>|delete <id>|help]';

function PlanMessage({message, isError}: {message: string; isError?: boolean}) {
	const {colors} = useTheme();
	return (
		<Box marginY={1}>
			<Text color={isError ? colors.error : colors.success}>{message}</Text>
		</Box>
	);
}

function messageElement(message: string, isError = false) {
	return React.createElement(PlanMessage, {
		key: generateKey(isError ? 'plans-error' : 'plans-message'),
		message,
		isError,
	});
}

function helpElement() {
	return messageElement(
		[
			'Plan graph commands:',
			'',
			'/plans                 List persisted plan graphs',
			'/plans show [id]       Show the active plan, or a specific plan by id',
			'/plans use <id>        Make a plan active (it is then added to every turn)',
			'/plans use none        Stop injecting any plan into the prompt',
			'/plans delete <id>     Delete a plan graph from .nanocoder/plans',
			'',
			'Plan graphs are written by write_plan and updated by update_plan_node.',
		].join('\n'),
	);
}

function errorMessage(error: unknown): string {
	return error instanceof PlanStoreError || error instanceof Error
		? error.message
		: String(error);
}

export function createPlansCommand(
	store: PlanStore = new PlanStore(),
): Command {
	return {
		name: 'plans',
		description: 'View and manage persistent plan graphs',
		handler: async (args: string[]) => {
			const subcommand = args[0]?.toLowerCase();

			try {
				if (subcommand === 'help') {
					return helpElement();
				}

				if (!subcommand || subcommand === 'list') {
					const [plans, activePlanId] = await Promise.all([
						store.listPlans(),
						store.getActivePlanId(),
					]);
					return React.createElement(PlanListDisplay, {
						key: generateKey('plans-list'),
						plans,
						activePlanId,
					});
				}

				if (subcommand === 'show') {
					const requestedId = args[1]?.trim();
					const planId = requestedId || (await store.getActivePlanId());
					if (!planId) {
						return messageElement(
							'No active plan. Use /plans show <id> or /plans list.',
							true,
						);
					}
					const plan = await store.loadPlan(planId);
					if (!plan) {
						return messageElement(`Plan "${planId}" not found.`, true);
					}
					const activePlanId = await store.getActivePlanId();
					return React.createElement(PlanGraphDisplay, {
						key: generateKey('plans-show'),
						plan,
						isActive: plan.id === activePlanId,
					});
				}

				if (subcommand === 'use') {
					const planId = args[1]?.trim();
					if (!planId) {
						return messageElement('Usage: /plans use <id|none>', true);
					}

					if (planId === 'none' || planId === 'off' || planId === '--none') {
						await store.setActivePlanId(null);
						return messageElement('No plan is active.');
					}

					const plan = await store.loadPlan(planId);
					if (!plan) {
						return messageElement(`Plan "${planId}" not found.`, true);
					}
					await store.setActivePlanId(planId);
					return React.createElement(PlanGraphDisplay, {
						key: generateKey('plans-use'),
						plan,
						isActive: true,
						message: `Active plan: ${plan.title}`,
					});
				}

				if (
					subcommand === 'delete' ||
					subcommand === 'remove' ||
					subcommand === 'rm'
				) {
					const planId = args[1]?.trim();
					if (!planId) {
						return messageElement('Usage: /plans delete <id>', true);
					}
					const deleted = await store.deletePlan(planId);
					if (!deleted) {
						return messageElement(`Plan "${planId}" not found.`, true);
					}

					const [plans, activePlanId] = await Promise.all([
						store.listPlans(),
						store.getActivePlanId(),
					]);
					return React.createElement(PlanListDisplay, {
						key: generateKey('plans-deleted'),
						plans,
						activePlanId,
						message: `Deleted plan: ${planId}`,
					});
				}

				return messageElement(USAGE, true);
			} catch (error) {
				return messageElement(errorMessage(error), true);
			}
		},
	};
}

export const plansCommand = createPlansCommand();
