import {Box, Text} from 'ink';
import {useEffect, useState} from 'react';
import {
	type ArtifactDescriptor,
	artifactManager,
} from '@/artifacts/artifact-manager';
import {useTheme} from '@/hooks/useTheme';
import {createTerminalFileLink} from '@/utils/terminal-file-link';

const ARTIFACT_LABELS: Record<ArtifactDescriptor['kind'], string> = {
	implementation_plan: 'Plan',
	task: 'Tasks',
	walkthrough: 'Walkthrough',
};

export function createTerminalArtifactLink(
	artifact: ArtifactDescriptor,
	label = ARTIFACT_LABELS[artifact.kind],
): string {
	return createTerminalFileLink(artifact.path, label);
}

export function ArtifactLinksDisplay({
	artifacts,
}: {
	artifacts: ArtifactDescriptor[];
}) {
	const {colors} = useTheme();
	if (artifacts.length === 0) return null;

	// Rendered under the composer next to the mode indicator, so the margin
	// goes on top — it separates this row from the status line above it.
	return (
		<Box gap={1} marginTop={1}>
			<Text color={colors.secondary}>Artifacts:</Text>
			{artifacts.map(artifact => (
				<Text key={artifact.kind} color={colors.primary} underline>
					{createTerminalArtifactLink(artifact)}
				</Text>
			))}
		</Box>
	);
}

export function SessionArtifactLinks({
	sessionId,
	refreshKey,
}: {
	sessionId: string | null;
	refreshKey: unknown;
}) {
	const [artifacts, setArtifacts] = useState<ArtifactDescriptor[]>([]);

	useEffect(() => {
		void refreshKey;
		let cancelled = false;
		setArtifacts([]);
		if (!sessionId) return () => {};

		void artifactManager
			.listArtifacts(sessionId)
			.then(found => {
				if (!cancelled) setArtifacts(found);
			})
			.catch(() => {
				if (!cancelled) setArtifacts([]);
			});

		return () => {
			cancelled = true;
		};
	}, [sessionId, refreshKey]);

	return <ArtifactLinksDisplay artifacts={artifacts} />;
}
