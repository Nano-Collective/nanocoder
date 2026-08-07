import {type ArtifactManager, artifactManager} from './artifact-manager';

export async function createApprovedPlanMessage(
	sessionId: string,
	manager: ArtifactManager = artifactManager,
): Promise<string> {
	const plan = await manager.readArtifact(sessionId, 'implementation_plan');
	if (!plan?.trim()) {
		throw new Error('The approved plan artifact is missing or empty');
	}

	return `The implementation plan below is approved. Proceed with implementing it now.\n\n<approved_plan>\n${plan}\n</approved_plan>`;
}
