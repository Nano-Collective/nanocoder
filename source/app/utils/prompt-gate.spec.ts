import test from 'ava';
import {
	canSubmitPrompt,
	canSubmitVoicePrompt,
	type VoiceGateState,
} from './prompt-gate.js';

const idle: VoiceGateState = {
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
};

test('idle chat accepts typed and voice prompts', t => {
	t.true(canSubmitPrompt(idle));
	t.true(canSubmitVoicePrompt(idle));
});

const modalStates: Array<[string, Partial<VoiceGateState>]> = [
	['before chat starts', {startChat: false}],
	['a selector mode', {activeMode: 'model'}],
	['/settings', {isSettingsMode: true}],
	['plan review', {planReviewState: {show: true}}],
	['architect review', {architectReviewState: {show: true}}],
	['a live component capturing input', {liveComponentCapturesInput: true}],
];

for (const [label, override] of modalStates) {
	test(`voice cannot submit while ${label} is open`, t => {
		const state = {...idle, ...override};
		t.false(canSubmitPrompt(state));
		t.false(canSubmitVoicePrompt(state));
	});
}

const decisionStates: Array<[string, Partial<VoiceGateState>]> = [
	['tool confirmation mode', {isToolConfirmationMode: true}],
	['an ask_user question', {isQuestionMode: true}],
	['a subagent approval', {hasPendingSubagentApproval: true}],
	['a pending tool confirmation', {hasPendingToolConfirmation: true}],
];

for (const [label, override] of decisionStates) {
	test(`voice cannot submit during ${label}`, t => {
		t.false(canSubmitVoicePrompt({...idle, ...override}));
	});
}

test('plan and architect review only gate input while shown', t => {
	t.true(
		canSubmitVoicePrompt({
			...idle,
			planReviewState: {show: false},
			architectReviewState: {show: false},
		}),
	);
});
