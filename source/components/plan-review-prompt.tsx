/**
 * Plan Review Prompt Component
 *
 * Interactive keyboard-navigable prompt for reviewing and approving
 * plan files before they are saved.
 */

import {Box, Static, Text, useInput} from 'ink';
import {useCallback, useMemo, useState} from 'react';
import type {PlanPhase} from '@/types/core';
import {PLAN_PHASE_LABELS} from '@/types/core';

interface PlanReviewData {
	planId: string;
	planFilePath: string;
	content: string;
	currentPhase: PlanPhase;
}

interface PlanReviewPromptProps {
	data: PlanReviewData;
	onApprove: () => void;
	onReject: () => void;
}

const CONTENT_PREVIEW_LINES = 15; // Number of lines to show in preview

export function PlanReviewPrompt({
	data,
	onApprove,
	onReject,
}: PlanReviewPromptProps) {
	const [selectedIndex, setSelectedIndex] = useState(0); // 0 = approve, 1 = reject
	const [showFullContent, setShowFullContent] = useState(false);

	const handleSelect = useCallback(() => {
		if (selectedIndex === 0) {
			onApprove();
		} else {
			onReject();
		}
	}, [selectedIndex, onApprove, onReject]);

	const handleCancel = useCallback(() => {
		onReject();
	}, [onReject]);

	useInput((input, key) => {
		if (key.leftArrow) {
			setSelectedIndex(0);
		} else if (key.rightArrow) {
			setSelectedIndex(1);
		} else if (key.upArrow || key.downArrow) {
			// Toggle full content view
			setShowFullContent(prev => !prev);
		} else if (key.return) {
			handleSelect();
		} else if (key.escape) {
			handleCancel();
		}
	});

	// Prepare content preview
	const contentLines = useMemo(() => {
		return data.content.split('\n');
	}, [data.content]);

	const displayLines = showFullContent
		? contentLines
		: contentLines.slice(0, CONTENT_PREVIEW_LINES);
	const hasMoreContent = contentLines.length > CONTENT_PREVIEW_LINES;

	const phaseLabel = PLAN_PHASE_LABELS[data.currentPhase];

	return (
		<Box flexDirection="column" marginTop={1} paddingX={1}>
			<Box>
				<Text bold color="#ffff00">
					{'▶'}
				</Text>
				<Text color="#ffff00">{' Plan Review - Confirm Save'}</Text>
			</Box>
			<Box marginTop={1}>
				<Text dimColor>
					Review the plan before saving (←/→ to select action, ↑/↓ to toggle
					full content, Enter to confirm, Esc to reject):
				</Text>
			</Box>

			{/* Plan Info */}
			<Box marginTop={1} flexDirection="column">
				<Box>
					<Text color="#00ffff">Plan ID: </Text>
					<Text>{data.planId}</Text>
				</Box>
				<Box>
					<Text color="#00ffff">Phase: </Text>
					<Text>{phaseLabel}</Text>
				</Box>
				<Box>
					<Text color="#00ffff">File: </Text>
					<Text dimColor>{data.planFilePath}</Text>
				</Box>
			</Box>

			{/* Content Preview */}
			<Box marginTop={1} flexDirection="column">
				<Text color="#00ffff">Plan Content Preview:</Text>
				<Box paddingLeft={1}>
					<Static items={displayLines}>
						{(line, index) => (
							<Box key={index}>
								<Text dimColor color="#666666">
									{String(index + 1).padStart(4, ' ')}{' '}
								</Text>
								<Text wrap="wrap">{line || ' '}</Text>
							</Box>
						)}
					</Static>
				</Box>
				{hasMoreContent && !showFullContent && (
					<Box>
						<Text dimColor>
							... ({contentLines.length - CONTENT_PREVIEW_LINES} more lines,
							press ↓ to show all)
						</Text>
					</Box>
				)}
			</Box>

			{/* Action Options */}
			<Box marginTop={1} flexDirection="column">
				<Box>
					<Text
						bold={selectedIndex === 0}
						color={selectedIndex === 0 ? '#00ff00' : 'white'}
					>
						{selectedIndex === 0 ? '▸ ' : '  '}
						Approve & Save
					</Text>
				</Box>
				<Box>
					<Text
						bold={selectedIndex === 1}
						color={selectedIndex === 1 ? '#ff0000' : 'white'}
					>
						{selectedIndex === 1 ? '▸ ' : '  '}
						Reject
					</Text>
				</Box>
			</Box>
		</Box>
	);
}

export default PlanReviewPrompt;
