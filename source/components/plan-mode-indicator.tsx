import {Box, Text} from 'ink';
import React, {useEffect, useState} from 'react';
import {getPlanId, getPlanPhase} from '@/context/mode-context';
import type {PlanPhase} from '@/types/core';
import {PLAN_PHASE_LABELS} from '@/types/core';

interface PlanModeIndicatorProps {
	/** Whether plan mode is currently active */
	active: boolean;
	/** Current plan phase (deprecated - now reads from global context) */
	phase?: PlanPhase;
	/** Current plan ID (deprecated - now reads from global context) */
	planId?: string | null;
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
 * Reads directly from global context and uses local state to trigger re-renders on phase changes
 */
export const PlanModeIndicator = React.memo(
	({
		active,
		successColor = '#00ff00',
		secondaryColor = '#888888',
		primaryColor = '#00bfff',
	}: PlanModeIndicatorProps) => {
		// Local state to force re-renders when global context changes
		const [, forceUpdate] = useState({});

		// Poll global context to detect phase changes and trigger re-render
		useEffect(() => {
			if (!active) {
				return;
			}

			// Poll interval to check for phase changes
			const interval = setInterval(() => {
				forceUpdate({});
			}, 500); // Check every 500ms

			return () => clearInterval(interval);
		}, [active]);

		// Read current phase and plan ID directly from global context
		const currentPhase = getPlanPhase();
		const currentPlanId = getPlanId();

		// Don't render anything if plan mode is not active
		if (!active || !currentPlanId) {
			return null;
		}

		const phaseIndicator = PHASE_INDICATORS[currentPhase] || '📋';
		const phaseLabel = PLAN_PHASE_LABELS[currentPhase];

		return (
			<Box marginTop={1}>
				<Text color={successColor}>
					<Text bold>
						Plan Mode: {phaseIndicator} {phaseLabel}
					</Text>
				</Text>
				<Text color={secondaryColor}> | </Text>
				<Text color={primaryColor}>{currentPlanId}</Text>
			</Box>
		);
	},
);

PlanModeIndicator.displayName = 'PlanModeIndicator';
