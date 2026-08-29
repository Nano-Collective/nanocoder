export interface PlanReviewRequest {
	artifactPath: string;
}

export interface PlanApprovalActions {
	readFile: (path: string) => Promise<string>;
	setMode: (mode: 'normal' | 'plan') => Promise<void>;
	prompt: (message: string) => Promise<void>;
}

export class PlanReviewController {
	private completedArtifactPath?: string;
	private _pendingReview?: PlanReviewRequest;

	get pendingReview(): PlanReviewRequest | undefined {
		return this._pendingReview;
	}

	observeSessionUpdate(payload: unknown): void {
		if (!payload || typeof payload !== 'object') return;
		const envelope = payload as Record<string, unknown>;
		const update =
			envelope.update && typeof envelope.update === 'object'
				? (envelope.update as Record<string, unknown>)
				: envelope;
		if (
			update.sessionUpdate !== 'tool_call_update' ||
			update.status !== 'completed'
		) {
			return;
		}

		const meta = update._meta;
		if (!meta || typeof meta !== 'object') return;
		const metadata = meta as Record<string, unknown>;
		const genericArtifact = metadata['nanocoder/artifact'];
		const genericPlan =
			genericArtifact &&
			typeof genericArtifact === 'object' &&
			(genericArtifact as Record<string, unknown>).kind ===
				'implementation_plan'
				? genericArtifact
				: undefined;
		const artifact = genericPlan ?? metadata['nanocoder/planArtifact'];
		if (!artifact || typeof artifact !== 'object') return;
		const artifactPath = (artifact as Record<string, unknown>).path;
		if (typeof artifactPath === 'string' && artifactPath.length > 0) {
			this.completedArtifactPath = artifactPath;
		}
	}

	completeTurn(mode: string | undefined): PlanReviewRequest | undefined {
		const artifactPath = this.completedArtifactPath;
		this.completedArtifactPath = undefined;
		if (mode !== 'plan' || !artifactPath) return undefined;
		this._pendingReview = {artifactPath};
		return this._pendingReview;
	}

	async approve(actions: PlanApprovalActions): Promise<void> {
		const review = this._pendingReview;
		if (!review) throw new Error('No implementation plan is awaiting review');

		const plan = await actions.readFile(review.artifactPath);
		if (!plan.trim()) {
			throw new Error('The approved plan artifact is missing or empty');
		}

		const approvedMessage =
			'The implementation plan below is approved. Proceed with implementing it now.\n\n' +
			`<approved_plan>\n${plan}\n</approved_plan>`;
		await actions.setMode('normal');
		try {
			await actions.prompt(approvedMessage);
		} catch (error) {
			// Approval is transactional from the UI's perspective: if the
			// implementation prompt never starts, put the session back in Plan
			// Mode so the restored review card can be revised as well as retried.
			try {
				await actions.setMode('plan');
			} catch {
				// Preserve the original prompt failure; mode restoration is best-effort.
			}
			throw error;
		}
		this._pendingReview = undefined;
	}

	revise(): void {
		this.reset();
	}

	reset(): void {
		this.completedArtifactPath = undefined;
		this._pendingReview = undefined;
	}
}
