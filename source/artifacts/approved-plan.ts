import type {Message} from '@/types/core';
import {type ArtifactManager, artifactManager} from './artifact-manager';

const APPROVED_PLAN_TAG = '<approved_plan>';

/** Sent when the plan artifact is available and can be embedded verbatim. */
const APPROVAL_WITH_ARTIFACT =
	'The implementation plan below is approved. Proceed with implementing it now.';

/**
 * Sent when no plan artifact exists. The plan is still in the conversation, so
 * the model has everything it needs; only the explicit copy is missing.
 */
const APPROVAL_WITHOUT_ARTIFACT =
	'The plan above is approved. Proceed with implementing it now.';

/**
 * Build the message that starts the implementation turn.
 *
 * Approval must never be a dead end. When the plan artifact exists we embed it
 * so the executing turn carries the plan explicitly. When it is missing or
 * empty — a small local model that never called `write_plan`, an unwritable
 * artifact directory — we fall back to referring to the plan already in the
 * conversation. Throwing here would strand the user on the review bar with no
 * way to approve.
 */
export async function createApprovedPlanMessage(
	sessionId: string,
	manager: ArtifactManager = artifactManager,
): Promise<string> {
	let plan: string | null = null;
	try {
		plan = await manager.readArtifact(sessionId, 'implementation_plan');
	} catch {
		plan = null;
	}

	if (!plan?.trim()) {
		return APPROVAL_WITHOUT_ARTIFACT;
	}

	return `${APPROVAL_WITH_ARTIFACT}\n\n${APPROVED_PLAN_TAG}\n${plan}\n</approved_plan>`;
}

/**
 * True for both approval forms. Callers use this to keep the synthetic
 * approval message out of session titles and to decide that a walkthrough is
 * expected for the turn it starts.
 */
export function isApprovedPlanMessage(message: Message): boolean {
	if (message.role !== 'user') return false;
	return (
		message.content.includes(APPROVED_PLAN_TAG) ||
		message.content.trim() === APPROVAL_WITHOUT_ARTIFACT
	);
}
