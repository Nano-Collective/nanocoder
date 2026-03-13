import test from 'ava';
import {PromptHistory} from '../prompt-history';
import {PlaceholderType, type InputState} from '../types/hooks';

/**
 * Tests for history navigation cycling behavior
 *
 * These tests verify that the history navigation properly cycles through:
 * - Up arrow: draft → last → ... → first → draft → last → ...
 * - Down arrow: draft → first → ... → last → draft → first → ...
 *
 * The user's in-progress draft is preserved throughout navigation.
 */

// Simulate the history navigation state machine
class HistoryNavigationSimulator {
	private historyIndex: number = -1;
	private originalInput: string = '';
	private savedDraft: InputState;
	private currentInput: string = '';
	private currentState: InputState;

	constructor(
		private history: InputState[],
		initialInput: string = '',
	) {
		this.currentInput = initialInput;
		this.currentState = {
			displayValue: initialInput,
			placeholderContent: {},
		};
		this.savedDraft = {...this.currentState};
	}

	// Simulates the Up arrow key navigation logic
	navigateUp(): void {
		if (this.history.length === 0) return;

		if (this.historyIndex === -1) {
			// Save current state before starting navigation
			this.savedDraft = this.currentState;
			this.originalInput = this.currentInput;
			this.historyIndex = this.history.length - 1;
			this.currentState = this.history[this.history.length - 1];
			this.currentInput = this.currentState.displayValue;
		} else if (this.historyIndex > 0) {
			const newIndex = this.historyIndex - 1;
			this.historyIndex = newIndex;
			this.currentState = this.history[newIndex];
			this.currentInput = this.currentState.displayValue;
		} else if (this.historyIndex === 0) {
			// At first history item, restore saved draft
			this.historyIndex = -2;
			this.currentState = this.savedDraft;
			this.currentInput = this.savedDraft.displayValue;
		} else if (this.historyIndex === -2) {
			// At draft, save any edits and cycle back to last history item
			this.savedDraft = this.currentState;
			this.historyIndex = this.history.length - 1;
			this.currentState = this.history[this.history.length - 1];
			this.currentInput = this.currentState.displayValue;
		}
	}

	// Simulates the Down arrow key navigation logic
	navigateDown(): void {
		if (this.history.length === 0) return;

		if (this.historyIndex === -1) {
			// Save draft, go to draft cycling state (visually a no-op)
			this.savedDraft = this.currentState;
			this.originalInput = this.currentInput;
			this.historyIndex = -2;
			this.currentState = this.savedDraft;
			this.currentInput = this.savedDraft.displayValue;
		} else if (this.historyIndex === -2) {
			// At draft, save any edits and cycle to first history item
			this.savedDraft = this.currentState;
			this.historyIndex = 0;
			this.currentState = this.history[0];
			this.currentInput = this.currentState.displayValue;
		} else if (this.historyIndex >= 0 && this.historyIndex < this.history.length - 1) {
			// Move forward in history
			const newIndex = this.historyIndex + 1;
			this.historyIndex = newIndex;
			this.currentState = this.history[newIndex];
			this.currentInput = this.currentState.displayValue;
		} else if (this.historyIndex === this.history.length - 1) {
			// At last history item, restore saved draft
			this.historyIndex = -2;
			this.currentState = this.savedDraft;
			this.currentInput = this.savedDraft.displayValue;
		}
	}

	getCurrentInput(): string {
		return this.currentInput;
	}

	getHistoryIndex(): number {
		return this.historyIndex;
	}

	getCurrentState(): InputState {
		return this.currentState;
	}
}

// ============================================================================
// Single Message History Tests
// ============================================================================

test('single message: up cycles through history → draft → history', t => {
	const history: InputState[] = [
		{displayValue: 'message1', placeholderContent: {}},
	];
	const nav = new HistoryNavigationSimulator(history, '');

	// Start at draft (index -1, empty draft)
	t.is(nav.getHistoryIndex(), -1);
	t.is(nav.getCurrentInput(), '');

	// Up → shows message
	nav.navigateUp();
	t.is(nav.getHistoryIndex(), 0);
	t.is(nav.getCurrentInput(), 'message1');

	// Up → draft (empty)
	nav.navigateUp();
	t.is(nav.getHistoryIndex(), -2);
	t.is(nav.getCurrentInput(), '');

	// Up → cycles back to message
	nav.navigateUp();
	t.is(nav.getHistoryIndex(), 0);
	t.is(nav.getCurrentInput(), 'message1');

	// Up → draft again
	nav.navigateUp();
	t.is(nav.getHistoryIndex(), -2);
	t.is(nav.getCurrentInput(), '');
});

test('single message: down cycles through draft → history → draft', t => {
	const history: InputState[] = [
		{displayValue: 'message1', placeholderContent: {}},
	];
	const nav = new HistoryNavigationSimulator(history, '');

	// Start at draft (index -1, empty draft)
	t.is(nav.getHistoryIndex(), -1);
	t.is(nav.getCurrentInput(), '');

	// Down → draft cycling state (visually same as draft)
	nav.navigateDown();
	t.is(nav.getHistoryIndex(), -2);
	t.is(nav.getCurrentInput(), '');

	// Down → message
	nav.navigateDown();
	t.is(nav.getHistoryIndex(), 0);
	t.is(nav.getCurrentInput(), 'message1');

	// Down → draft again
	nav.navigateDown();
	t.is(nav.getHistoryIndex(), -2);
	t.is(nav.getCurrentInput(), '');

	// Down → cycles back to message
	nav.navigateDown();
	t.is(nav.getHistoryIndex(), 0);
	t.is(nav.getCurrentInput(), 'message1');
});

test('single message: up then down restores draft', t => {
	const history: InputState[] = [
		{displayValue: 'message1', placeholderContent: {}},
	];
	const nav = new HistoryNavigationSimulator(history, 'typing...');

	// Start with user typing
	t.is(nav.getCurrentInput(), 'typing...');

	// Up → shows history
	nav.navigateUp();
	t.is(nav.getCurrentInput(), 'message1');

	// Down → restores draft
	nav.navigateDown();
	t.is(nav.getCurrentInput(), 'typing...');
});

// ============================================================================
// Multiple Message History Tests
// ============================================================================

test('three messages: up cycles correctly', t => {
	const history: InputState[] = [
		{displayValue: 'message1', placeholderContent: {}},
		{displayValue: 'message2', placeholderContent: {}},
		{displayValue: 'message3', placeholderContent: {}},
	];
	const nav = new HistoryNavigationSimulator(history, '');

	// Start at blank
	t.is(nav.getCurrentInput(), '');

	// Up → message3 (last)
	nav.navigateUp();
	t.is(nav.getCurrentInput(), 'message3');

	// Up → message2
	nav.navigateUp();
	t.is(nav.getCurrentInput(), 'message2');

	// Up → message1 (first)
	nav.navigateUp();
	t.is(nav.getCurrentInput(), 'message1');

	// Up → blank
	nav.navigateUp();
	t.is(nav.getCurrentInput(), '');

	// Up → cycles back to message3
	nav.navigateUp();
	t.is(nav.getCurrentInput(), 'message3');
});

test('three messages: down cycles correctly', t => {
	const history: InputState[] = [
		{displayValue: 'message1', placeholderContent: {}},
		{displayValue: 'message2', placeholderContent: {}},
		{displayValue: 'message3', placeholderContent: {}},
	];
	const nav = new HistoryNavigationSimulator(history, '');

	// Start at blank
	t.is(nav.getCurrentInput(), '');

	// Down → blank cycling state
	nav.navigateDown();
	t.is(nav.getCurrentInput(), '');

	// Down → message1 (first)
	nav.navigateDown();
	t.is(nav.getCurrentInput(), 'message1');

	// Down → message2
	nav.navigateDown();
	t.is(nav.getCurrentInput(), 'message2');

	// Down → message3 (last)
	nav.navigateDown();
	t.is(nav.getCurrentInput(), 'message3');

	// Down → blank
	nav.navigateDown();
	t.is(nav.getCurrentInput(), '');

	// Down → cycles back to message1
	nav.navigateDown();
	t.is(nav.getCurrentInput(), 'message1');
});

test('three messages: mixing up and down navigation', t => {
	const history: InputState[] = [
		{displayValue: 'message1', placeholderContent: {}},
		{displayValue: 'message2', placeholderContent: {}},
		{displayValue: 'message3', placeholderContent: {}},
	];
	const nav = new HistoryNavigationSimulator(history, '');

	// Up twice
	nav.navigateUp();
	nav.navigateUp();
	t.is(nav.getCurrentInput(), 'message2');

	// Down once
	nav.navigateDown();
	t.is(nav.getCurrentInput(), 'message3');

	// Down again
	nav.navigateDown();
	t.is(nav.getCurrentInput(), '');

	// Up once
	nav.navigateUp();
	t.is(nav.getCurrentInput(), 'message3');
});

// ============================================================================
// Draft Preservation Tests
// ============================================================================

test('draft is preserved when navigating up through all history and back', t => {
	const history: InputState[] = [
		{displayValue: 'message1', placeholderContent: {}},
		{displayValue: 'message2', placeholderContent: {}},
	];
	const nav = new HistoryNavigationSimulator(history, 'my draft');

	// Start with draft
	t.is(nav.getCurrentInput(), 'my draft');

	// Up → message2
	nav.navigateUp();
	t.is(nav.getCurrentInput(), 'message2');

	// Up → message1
	nav.navigateUp();
	t.is(nav.getCurrentInput(), 'message1');

	// Up → draft restored
	nav.navigateUp();
	t.is(nav.getHistoryIndex(), -2);
	t.is(nav.getCurrentInput(), 'my draft');

	// Up → cycles back to message2
	nav.navigateUp();
	t.is(nav.getCurrentInput(), 'message2');
});

test('draft is preserved when navigating down through all history and back', t => {
	const history: InputState[] = [
		{displayValue: 'message1', placeholderContent: {}},
		{displayValue: 'message2', placeholderContent: {}},
	];
	const nav = new HistoryNavigationSimulator(history, 'my draft');

	// Down → draft cycling state (still shows draft)
	nav.navigateDown();
	t.is(nav.getCurrentInput(), 'my draft');

	// Down → message1
	nav.navigateDown();
	t.is(nav.getCurrentInput(), 'message1');

	// Down → message2
	nav.navigateDown();
	t.is(nav.getCurrentInput(), 'message2');

	// Down → draft restored
	nav.navigateDown();
	t.is(nav.getHistoryIndex(), -2);
	t.is(nav.getCurrentInput(), 'my draft');
});

test('draft is preserved across mixed up/down navigation', t => {
	const history: InputState[] = [
		{displayValue: 'old', placeholderContent: {}},
	];
	const nav = new HistoryNavigationSimulator(history, 'wip');

	// Up → history
	nav.navigateUp();
	t.is(nav.getCurrentInput(), 'old');

	// Down → back to draft
	nav.navigateDown();
	t.is(nav.getCurrentInput(), 'wip');

	// Up again → history
	nav.navigateUp();
	t.is(nav.getCurrentInput(), 'old');

	// Up again → back to draft
	nav.navigateUp();
	t.is(nav.getCurrentInput(), 'wip');
});

// ============================================================================
// Empty History Tests
// ============================================================================

test('empty history: navigation does nothing', t => {
	const history: InputState[] = [];
	const nav = new HistoryNavigationSimulator(history, 'test');

	// Start with input
	t.is(nav.getCurrentInput(), 'test');

	// Up does nothing
	nav.navigateUp();
	t.is(nav.getCurrentInput(), 'test');

	// Down does nothing
	nav.navigateDown();
	t.is(nav.getCurrentInput(), 'test');
});

// ============================================================================
// Edge Case Tests
// ============================================================================

test('history with placeholders: navigation preserves InputState', t => {
	const history: InputState[] = [
		{
			displayValue: 'message with [Paste #1: 100 chars]',
			placeholderContent: {
				'1': {
					type: PlaceholderType.PASTE,
					content: 'x'.repeat(100),
					displayText: '[Paste #1: 100 chars]',
					originalSize: 100,
				},
			},
		},
	];
	const nav = new HistoryNavigationSimulator(history, '');

	// Navigate to history
	nav.navigateUp();
	const state = nav.getCurrentState();

	t.is(state.displayValue, 'message with [Paste #1: 100 chars]');
	t.truthy(state.placeholderContent['1']);
	t.is(state.placeholderContent['1'].content, 'x'.repeat(100));
});

test('continuous cycling: 10 ups then 10 downs returns to start', t => {
	const history: InputState[] = [
		{displayValue: 'message1', placeholderContent: {}},
		{displayValue: 'message2', placeholderContent: {}},
	];
	const nav = new HistoryNavigationSimulator(history, 'original');

	// Save starting state
	const startIndex = nav.getHistoryIndex();

	// Navigate up 10 times (should cycle)
	for (let i = 0; i < 10; i++) {
		nav.navigateUp();
	}

	// Navigate down 10 times (should return to similar state)
	for (let i = 0; i < 10; i++) {
		nav.navigateDown();
	}

	// Should be back at a predictable state
	// After 10 ups and 10 downs, we should be at draft state
	t.is(nav.getHistoryIndex(), -2);
});

// ============================================================================
// Integration with PromptHistory Tests
// ============================================================================

test('integration: PromptHistory provides correct history for navigation', async t => {
	// Create a temporary history file for testing
	const tempFile = `/tmp/test-history-${Date.now()}.txt`;
	const history = new PromptHistory(tempFile);

	// Add some prompts
	history.addPrompt({displayValue: 'first', placeholderContent: {}});
	history.addPrompt({displayValue: 'second', placeholderContent: {}});
	history.addPrompt({displayValue: 'third', placeholderContent: {}});

	// Get history
	const historyArray = history.getHistory();

	// Verify we can navigate through it
	const nav = new HistoryNavigationSimulator(historyArray, '');

	nav.navigateUp();
	t.is(nav.getCurrentInput(), 'third');

	nav.navigateUp();
	t.is(nav.getCurrentInput(), 'second');

	nav.navigateUp();
	t.is(nav.getCurrentInput(), 'first');

	// Cleanup
	await history.saveHistory();
});
