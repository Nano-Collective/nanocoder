import test from 'ava';
import {
	activeInputSurfaces,
	type InputOwnershipState,
	resolveInputOwnership,
} from './input-owner.js';

const idle: InputOwnershipState = {
	startChat: true,
	activeMode: null,
	isSettingsMode: false,
	planReviewState: null,
	architectReviewState: null,
	liveComponentCapturesInput: false,
	isToolConfirmationMode: false,
	isQuestionMode: false,
	hasPendingSubagentApproval: false,
	hasPendingToolConfirmation: false,
	agentBusy: false,
	hasPendingPlanProceed: false,
};

const resolve = (override: Partial<InputOwnershipState> = {}) =>
	resolveInputOwnership({...idle, ...override});

test('idle chat: the composer owns input and accepts typed and voice prompts', t => {
	const ownership = resolve();
	t.is(ownership.owner, 'composer');
	t.deepEqual(ownership.surfaces, []);
	t.true(ownership.composerAvailable);
	t.true(ownership.voiceInputAllowed);
	t.false(ownership.showModalSelectors);
	t.true(ownership.transcriptScrollable);
	t.false(ownership.cancellable);
	t.false(ownership.queueDrainBlocked);
});

const modalStates: Array<[string, Partial<InputOwnershipState>]> = [
	['before chat starts', {startChat: false}],
	['a selector mode', {activeMode: 'model'}],
	['/settings', {isSettingsMode: true}],
	['plan review', {planReviewState: {show: true}}],
	['architect review', {architectReviewState: {show: true}}],
	['a live component capturing input', {liveComponentCapturesInput: true}],
];

for (const [label, override] of modalStates) {
	test(`neither typed nor voice input can submit while ${label} is open`, t => {
		const ownership = resolve(override);
		t.false(ownership.composerAvailable);
		t.false(ownership.voiceInputAllowed);
	});
}

const decisionStates: Array<[string, Partial<InputOwnershipState>]> = [
	['tool confirmation mode', {isToolConfirmationMode: true}],
	['an ask_user question', {isQuestionMode: true}],
	['a subagent approval', {hasPendingSubagentApproval: true}],
	['a pending tool confirmation', {hasPendingToolConfirmation: true}],
];

for (const [label, override] of decisionStates) {
	test(`voice cannot submit during ${label}, and Escape does not cancel`, t => {
		const ownership = resolve({...override, agentBusy: true});
		// The composer stays mounted: it renders the decision prompt.
		t.true(ownership.composerAvailable);
		t.false(ownership.voiceInputAllowed);
		t.false(ownership.cancellable);
		t.true(ownership.queueDrainBlocked);
	});
}

test('plan and architect review only gate input while shown', t => {
	const ownership = resolve({
		planReviewState: {show: false},
		architectReviewState: {show: false},
	});
	t.true(ownership.voiceInputAllowed);
	t.is(ownership.owner, 'composer');
});

test('busy work is cancellable from the composer but not under a live capture', t => {
	t.true(resolve({agentBusy: true}).cancellable);
	t.false(
		resolve({agentBusy: true, liveComponentCapturesInput: true}).cancellable,
	);
});

test('explorer and IDE selection capture scroll but are not modal selectors', t => {
	for (const activeMode of ['explorer', 'ideSelection']) {
		const ownership = resolve({activeMode});
		t.is(ownership.owner, activeMode as 'explorer' | 'ideSelection');
		t.false(ownership.showModalSelectors);
		t.false(ownership.transcriptScrollable);
		t.true(ownership.queueDrainBlocked);
	}
});

test('settings outranks a selector mode for ownership', t => {
	t.deepEqual(
		activeInputSurfaces({...idle, isSettingsMode: true, activeMode: 'model'}),
		['settings', 'selector'],
	);
});

test('a pending plan proceed blocks the queue drain on its own', t => {
	t.true(resolve({hasPendingPlanProceed: true}).queueDrainBlocked);
});

// The predicates interactive-app.tsx computed by hand before they were derived
// from one ownership resolution. Kept verbatim as an oracle: the refactor must
// agree with them on every combination of flags.
function legacyPredicates(s: InputOwnershipState) {
	const composerAvailable =
		s.startChat &&
		s.activeMode === null &&
		!s.isSettingsMode &&
		!s.planReviewState?.show &&
		!s.architectReviewState?.show &&
		!s.liveComponentCapturesInput;
	const voiceInputAllowed =
		composerAvailable &&
		!s.isToolConfirmationMode &&
		!s.isQuestionMode &&
		!s.hasPendingSubagentApproval &&
		!s.hasPendingToolConfirmation;
	const showModalSelectors =
		(s.activeMode !== null &&
			s.activeMode !== 'explorer' &&
			s.activeMode !== 'ideSelection') ||
		s.isSettingsMode;
	const transcriptScrollable =
		!showModalSelectors &&
		s.activeMode !== 'explorer' &&
		s.activeMode !== 'ideSelection';
	const cancellable =
		!s.isToolConfirmationMode &&
		!s.isQuestionMode &&
		!s.hasPendingSubagentApproval &&
		!s.hasPendingToolConfirmation &&
		s.agentBusy &&
		!s.liveComponentCapturesInput;
	const queueDrainBlocked =
		s.agentBusy ||
		s.isToolConfirmationMode ||
		s.isQuestionMode ||
		s.hasPendingSubagentApproval ||
		s.hasPendingToolConfirmation ||
		s.planReviewState?.show === true ||
		s.architectReviewState?.show === true ||
		s.hasPendingPlanProceed ||
		// Checked separately inside the drain effect.
		s.activeMode !== null ||
		s.isSettingsMode;
	return {
		composerAvailable,
		voiceInputAllowed,
		showModalSelectors,
		transcriptScrollable,
		cancellable,
		queueDrainBlocked,
	};
}

test('agrees with the legacy hand-rolled predicates on every flag combination', t => {
	const booleanKeys = [
		'startChat',
		'isSettingsMode',
		'liveComponentCapturesInput',
		'isToolConfirmationMode',
		'isQuestionMode',
		'hasPendingSubagentApproval',
		'hasPendingToolConfirmation',
		'agentBusy',
		'hasPendingPlanProceed',
	] as const;
	const modes = [null, 'model', 'tune', 'explorer', 'ideSelection'];
	const reviews = [null, {show: false}, {show: true}];

	let checked = 0;
	for (let bits = 0; bits < 1 << booleanKeys.length; bits++) {
		const flags = Object.fromEntries(
			booleanKeys.map((key, i) => [key, Boolean(bits & (1 << i))]),
		) as Record<(typeof booleanKeys)[number], boolean>;
		for (const activeMode of modes) {
			for (const planReviewState of reviews) {
				for (const architectReviewState of reviews) {
					const state: InputOwnershipState = {
						...flags,
						activeMode,
						planReviewState,
						architectReviewState,
					};
					const {owner: _owner, surfaces, ...derived} =
						resolveInputOwnership(state);
					const expected = legacyPredicates(state);
					// Only the composer owns input when no surface is active.
					const ownerConsistent =
						(surfaces.length === 0) === derived.voiceInputAllowed;
					if (
						!ownerConsistent ||
						JSON.stringify(derived) !== JSON.stringify(expected)
					) {
						t.fail(
							`mismatch for ${JSON.stringify(state)}: got ${JSON.stringify(
								derived,
							)}, expected ${JSON.stringify(expected)}`,
						);
						return;
					}
					checked++;
				}
			}
		}
	}
	t.is(checked, 512 * 5 * 9);
});
