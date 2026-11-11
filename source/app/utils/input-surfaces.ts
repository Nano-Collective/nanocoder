import type {SettingsTabId} from '@/app/components/settings-constants';

/** A full-screen mode that replaces the chat input (selectors, wizards, ...). */
export type ActiveMode =
	| 'model'
	| 'modelDatabase'
	| 'configWizard'
	| 'explorer'
	| 'ideSelection'
	| 'checkpointLoad'
	| 'sessionSelector'
	| 'tune'
	| null;

/** Post-plan-generation action bar. */
export type PlanReviewState = {
	show: boolean;
	originalMessage: string;
} | null;

/** Post-turn aggregate file review in architect mode. */
export type ArchitectReviewState = {
	show: boolean;
	checkpointName: string;
	filesChanged: string[];
	filesMissing: string[];
} | null;

/**
 * Every surface that can take the keyboard from the chat input, held as one
 * value. resolveInputOwnership (input-owner.ts) reads it to decide who owns
 * input; the onEnter* / handle*Cancel mode handlers write it through the
 * setters useAppState exposes.
 */
export interface InputSurfacesState {
	activeMode: ActiveMode;
	isSettingsMode: boolean;
	settingsActiveTab: SettingsTabId | undefined;
	planReviewState: PlanReviewState;
	architectReviewState: ArchitectReviewState;
	isToolConfirmationMode: boolean;
	isQuestionMode: boolean;
	liveComponentCapturesInput: boolean;
}

export const initialInputSurfaces: InputSurfacesState = {
	activeMode: null,
	isSettingsMode: false,
	settingsActiveTab: undefined,
	planReviewState: null,
	architectReviewState: null,
	isToolConfirmationMode: false,
	isQuestionMode: false,
	liveComponentCapturesInput: false,
};

export type InputSurfacesAction = {
	[K in keyof InputSurfacesState]: {
		type: 'set';
		field: K;
		value: InputSurfacesState[K];
	};
}[keyof InputSurfacesState];

/**
 * Set one surface. Returns the same state object when the value is
 * unchanged, so React skips the render exactly as it does for useState.
 */
export function inputSurfacesReducer(
	state: InputSurfacesState,
	action: InputSurfacesAction,
): InputSurfacesState {
	if (Object.is(state[action.field], action.value)) return state;
	return {...state, [action.field]: action.value};
}
