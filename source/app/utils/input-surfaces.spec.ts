import test from 'ava';
import {resolveInputOwnership} from './input-owner.js';
import {
	type InputSurfacesAction,
	initialInputSurfaces,
	inputSurfacesReducer,
} from './input-surfaces.js';

const run = (...actions: InputSurfacesAction[]) =>
	actions.reduce(inputSurfacesReducer, initialInputSurfaces);

const ownership = (...actions: InputSurfacesAction[]) =>
	resolveInputOwnership({
		...run(...actions),
		startChat: true,
		hasPendingSubagentApproval: false,
		hasPendingToolConfirmation: false,
		agentBusy: false,
		hasPendingPlanProceed: false,
	});

test('the initial surfaces leave the composer owning input', t => {
	t.is(ownership().owner, 'composer');
	t.true(ownership().composerAvailable);
});

test('set replaces one field and leaves the others alone', t => {
	const state = run(
		{type: 'set', field: 'isSettingsMode', value: true},
		{type: 'set', field: 'settingsActiveTab', value: 'appearance'},
	);
	t.true(state.isSettingsMode);
	t.is(state.settingsActiveTab, 'appearance');
	t.deepEqual(
		{...state, isSettingsMode: false, settingsActiveTab: undefined},
		initialInputSurfaces,
	);
});

test('setting an unchanged value returns the same object, like useState', t => {
	t.is(
		inputSurfacesReducer(initialInputSurfaces, {
			type: 'set',
			field: 'activeMode',
			value: null,
		}),
		initialInputSurfaces,
	);
	const review = {show: true, originalMessage: ''};
	const withReview = run({type: 'set', field: 'planReviewState', value: review});
	t.is(
		inputSurfacesReducer(withReview, {
			type: 'set',
			field: 'planReviewState',
			value: review,
		}),
		withReview,
	);
});

test('each surface written through the reducer is seen by the ownership resolver', t => {
	const cases: Array<[InputSurfacesAction, string]> = [
		[{type: 'set', field: 'isSettingsMode', value: true}, 'settings'],
		[{type: 'set', field: 'activeMode', value: 'model'}, 'selector'],
		[{type: 'set', field: 'activeMode', value: 'explorer'}, 'explorer'],
		[{type: 'set', field: 'activeMode', value: 'ideSelection'}, 'ideSelection'],
		[
			{
				type: 'set',
				field: 'planReviewState',
				value: {show: true, originalMessage: ''},
			},
			'planReview',
		],
		[
			{
				type: 'set',
				field: 'architectReviewState',
				value: {
					show: true,
					checkpointName: 'c',
					filesChanged: [],
					filesMissing: [],
				},
			},
			'architectReview',
		],
		[
			{type: 'set', field: 'liveComponentCapturesInput', value: true},
			'liveCapture',
		],
		[
			{type: 'set', field: 'isToolConfirmationMode', value: true},
			'toolConfirmation',
		],
		[{type: 'set', field: 'isQuestionMode', value: true}, 'question'],
	];
	for (const [action, owner] of cases) {
		t.is(ownership(action).owner, owner, JSON.stringify(action));
	}
});
