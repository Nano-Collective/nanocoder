/**
 * Who owns keyboard input in the interactive TUI, and which surface is on
 * screen in place of (or inside) the composer.
 *
 * The app keeps one flag per surface (`activeMode`, `isSettingsMode`, the plan
 * and architect review states, the decision prompts, ...). Every question the
 * UI asks about them - can the composer submit, may voice submit, does Escape
 * cancel, may the queue drain, does the transcript scroll - used to be a
 * hand-rolled predicate over a different subset of those flags, and they
 * drifted apart (voice once submitted straight past an open /settings panel).
 *
 * Here the flags are resolved once into the list of active surfaces, and each
 * predicate is read off a single policy table. Adding a surface means adding a
 * row to INPUT_SURFACE_POLICY; it cannot be forgotten by one predicate and
 * remembered by another.
 */

export type InputSurface =
	// A full-panel modal rendered by ModalSelectors.
	| 'settings'
	| 'selector'
	// activeMode surfaces rendered outside ModalSelectors.
	| 'explorer'
	| 'ideSelection'
	// Post-turn action bars with their own useInput.
	| 'planReview'
	| 'architectReview'
	// A live component (e.g. an interactive tool) that claimed the keyboard.
	| 'liveCapture'
	// Decision prompts ChatInput renders in place of its text box.
	| 'toolConfirmation'
	| 'question'
	| 'subagentApproval'
	// Startup: the chat surface has not been shown yet.
	| 'starting';

interface InputSurfacePolicy {
	/** Unmounts the composer, so nothing behind it can submit a prompt. */
	hidesComposer: boolean;
	/**
	 * Handles Escape itself. A generation in flight must not be cancelled by
	 * the section-level Escape handler while one of these is active, or the
	 * decline / dismiss key would also abort the turn.
	 */
	ownsEscape: boolean;
	/** Queued prompts wait until this surface closes. */
	blocksQueueDrain: boolean;
	/** Takes over the keys that would otherwise scroll the transcript. */
	capturesScroll: boolean;
	/** Rendered by ModalSelectors. */
	modalSelector: boolean;
}

const INPUT_SURFACE_POLICY: Record<InputSurface, InputSurfacePolicy> = {
	settings: {
		hidesComposer: true,
		ownsEscape: false,
		blocksQueueDrain: true,
		capturesScroll: true,
		modalSelector: true,
	},
	selector: {
		hidesComposer: true,
		ownsEscape: false,
		blocksQueueDrain: true,
		capturesScroll: true,
		modalSelector: true,
	},
	explorer: {
		hidesComposer: true,
		ownsEscape: false,
		blocksQueueDrain: true,
		capturesScroll: true,
		modalSelector: false,
	},
	ideSelection: {
		hidesComposer: true,
		ownsEscape: false,
		blocksQueueDrain: true,
		capturesScroll: true,
		modalSelector: false,
	},
	planReview: {
		hidesComposer: true,
		ownsEscape: false,
		blocksQueueDrain: true,
		capturesScroll: false,
		modalSelector: false,
	},
	// The architect gate runs its own useInput. Leaving the composer mounted
	// alongside it gave every keystroke two live consumers, and let the user
	// submit a new turn straight past the gate with the checkpoint still open.
	architectReview: {
		hidesComposer: true,
		ownsEscape: false,
		blocksQueueDrain: true,
		capturesScroll: false,
		modalSelector: false,
	},
	// Hide the composer only while a live component explicitly captures input
	// (bash-style live execution keeps it mounted).
	liveCapture: {
		hidesComposer: true,
		ownsEscape: true,
		blocksQueueDrain: false,
		capturesScroll: false,
		modalSelector: false,
	},
	toolConfirmation: {
		hidesComposer: false,
		ownsEscape: true,
		blocksQueueDrain: true,
		capturesScroll: false,
		modalSelector: false,
	},
	question: {
		hidesComposer: false,
		ownsEscape: true,
		blocksQueueDrain: true,
		capturesScroll: false,
		modalSelector: false,
	},
	subagentApproval: {
		hidesComposer: false,
		ownsEscape: true,
		blocksQueueDrain: true,
		capturesScroll: false,
		modalSelector: false,
	},
	// The queue drain has its own readiness checks (client, tool manager,
	// conversation complete), so startup does not block it here.
	starting: {
		hidesComposer: true,
		ownsEscape: false,
		blocksQueueDrain: false,
		capturesScroll: false,
		modalSelector: false,
	},
};

export interface InputOwnershipState {
	startChat: boolean;
	activeMode: string | null;
	isSettingsMode: boolean;
	planReviewState: {show: boolean} | null;
	architectReviewState: {show: boolean} | null;
	liveComponentCapturesInput: boolean;
	isToolConfirmationMode: boolean;
	isQuestionMode: boolean;
	hasPendingSubagentApproval: boolean;
	hasPendingToolConfirmation: boolean;
	/** Work in flight: generation, tool execution, or a cancel settling. */
	agentBusy: boolean;
	/** An approved plan is waiting for the mode switch before it dispatches. */
	hasPendingPlanProceed: boolean;
}

export interface InputOwnership {
	/**
	 * The surface that owns input, highest priority first, or 'composer' when
	 * nothing is in front of the text box.
	 */
	owner: InputSurface | 'composer';
	/** Every active surface, in priority order. */
	surfaces: readonly InputSurface[];
	/** The composer is mounted and can submit a typed prompt. */
	composerAvailable: boolean;
	/**
	 * A voice transcript may be submitted as a prompt: the composer gate plus
	 * the decision prompts the composer renders in place of its text box, since
	 * typed input can't submit there either.
	 */
	voiceInputAllowed: boolean;
	/** ModalSelectors has something to render. */
	showModalSelectors: boolean;
	/** The transcript may take scroll keys (before composer-local overlays). */
	transcriptScrollable: boolean;
	/** Escape should cancel the in-flight work right now. */
	cancellable: boolean;
	/** Queued prompts must wait (busy, or a surface that blocks the drain). */
	queueDrainBlocked: boolean;
}

/** Resolve the per-surface flags into the active surfaces, highest first. */
export function activeInputSurfaces(
	state: InputOwnershipState,
): InputSurface[] {
	const surfaces: InputSurface[] = [];
	if (state.isSettingsMode) surfaces.push('settings');
	if (state.activeMode === 'explorer') surfaces.push('explorer');
	else if (state.activeMode === 'ideSelection') surfaces.push('ideSelection');
	else if (state.activeMode !== null) surfaces.push('selector');
	if (state.planReviewState?.show) surfaces.push('planReview');
	if (state.architectReviewState?.show) surfaces.push('architectReview');
	if (state.liveComponentCapturesInput) surfaces.push('liveCapture');
	if (state.isToolConfirmationMode || state.hasPendingToolConfirmation) {
		surfaces.push('toolConfirmation');
	}
	if (state.isQuestionMode) surfaces.push('question');
	if (state.hasPendingSubagentApproval) surfaces.push('subagentApproval');
	if (!state.startChat) surfaces.push('starting');
	return surfaces;
}

export function resolveInputOwnership(
	state: InputOwnershipState,
): InputOwnership {
	const surfaces = activeInputSurfaces(state);
	const any = (flag: keyof InputSurfacePolicy) =>
		surfaces.some(surface => INPUT_SURFACE_POLICY[surface][flag]);

	return {
		owner: surfaces[0] ?? 'composer',
		surfaces,
		composerAvailable: !any('hidesComposer'),
		voiceInputAllowed: surfaces.length === 0,
		showModalSelectors: any('modalSelector'),
		transcriptScrollable: !any('capturesScroll'),
		cancellable: state.agentBusy && !any('ownsEscape'),
		queueDrainBlocked:
			state.agentBusy || state.hasPendingPlanProceed || any('blocksQueueDrain'),
	};
}
