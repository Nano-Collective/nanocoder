export type ArtifactKind = 'implementation_plan' | 'task' | 'walkthrough';

export interface ArtifactDescriptor {
	kind: ArtifactKind;
	path: string;
}

const ARTIFACT_ORDER: ArtifactKind[] = [
	'implementation_plan',
	'task',
	'walkthrough',
];

export class ArtifactController {
	private readonly byKind = new Map<ArtifactKind, ArtifactDescriptor>();

	get artifacts(): ArtifactDescriptor[] {
		return ARTIFACT_ORDER.flatMap(kind => {
			const artifact = this.byKind.get(kind);
			return artifact ? [artifact] : [];
		});
	}

	observeSessionUpdate(payload: unknown): void {
		if (!payload || typeof payload !== 'object') return;
		const envelope = payload as Record<string, unknown>;
		const update =
			envelope.update && typeof envelope.update === 'object'
				? (envelope.update as Record<string, unknown>)
				: envelope;
		const meta = update._meta;
		if (!meta || typeof meta !== 'object') return;
		const artifact = this.parseArtifact(
			(meta as Record<string, unknown>)['nanocoder/artifact'],
		);
		if (artifact) this.byKind.set(artifact.kind, artifact);
	}

	replaceFromMeta(meta: unknown): void {
		this.reset();
		if (!meta || typeof meta !== 'object') return;
		const artifacts = (meta as Record<string, unknown>)[
			'nanocoder/artifacts'
		];
		if (!Array.isArray(artifacts)) return;
		for (const value of artifacts) {
			const artifact = this.parseArtifact(value);
			if (artifact) this.byKind.set(artifact.kind, artifact);
		}
	}

	reset(): void {
		this.byKind.clear();
	}

	private parseArtifact(value: unknown): ArtifactDescriptor | undefined {
		if (!value || typeof value !== 'object') return undefined;
		const candidate = value as Record<string, unknown>;
		if (
			typeof candidate.kind !== 'string' ||
			!ARTIFACT_ORDER.includes(candidate.kind as ArtifactKind) ||
			typeof candidate.path !== 'string' ||
			candidate.path.length === 0
		) {
			return undefined;
		}
		return {
			kind: candidate.kind as ArtifactKind,
			path: candidate.path,
		};
	}
}
