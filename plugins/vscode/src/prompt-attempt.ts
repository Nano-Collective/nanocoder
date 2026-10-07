export class PromptAttempt {
	private cancelled = false;

	get cancelRequested(): boolean {
		return this.cancelled;
	}

	cancel(): void {
		this.cancelled = true;
	}
}
