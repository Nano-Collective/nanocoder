import {Box, Text} from 'ink';
import React from 'react';
import type {PlanPhase} from '@/types/core';
import {PLAN_PHASE_LABELS} from '@/types/core';

interface PlanModeIndicatorProps {
	/** Whether plan mode is currently active */
	active: boolean;
	/** Current plan phase */
	phase: PlanPhase;
	/** Current plan ID */
	planId: string | null;
	/** Color for success/highlight elements */
	successColor?: string;
	/** Color for secondary/separator elements */
	secondaryColor?: string;
	/** Color for primary/plan ID elements */
	primaryColor?: string;
}

/**
 * Visual indicators for plan phases (emoji badges)
 */
const PHASE_INDICATORS: Record<string, string> = {
	understanding: '🔍',
	design: '🎨',
	review: '🔎',
	final: '✅',
	exit: '🚪',
};

/**
 * Plan mode indicator component
 * Shows the current plan phase and plan ID when plan mode is active
 * Only renders when active is true and planId is set
 */
export const PlanModeIndicator = React.memo(
	({
		active,
		phase,
		planId,
		successColor = '#00ff00',
		secondaryColor = '#888888',
		primaryColor = '#00bfff',
	}: PlanModeIndicatorProps) => {
		// Don't render anything if plan mode is not active
		if (!active || !planId) {
			return null;
		}

		const phaseIndicator = PHASE_INDICATORS[phase] || '📋';
		const phaseLabel = PLAN_PHASE_LABELS[phase];

		return (
			<Box marginTop={1}>
				<Text color={successColor}>
					<Text bold>Plan Mode: {phaseIndicator} {phaseLabel}</Text>
				</Text>
				<Text color={secondaryColor}> | </Text>
				<Text color={primaryColor}>{planId}</Text>
			</Box>
		);
	},
);

PlanModeIndicator.displayName = 'PlanModeIndicator';
