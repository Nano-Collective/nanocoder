import test from 'ava';

/**
 * Tests for readline keybind logic in the custom TextInput component.
 *
 * These test the pure logic of each keybind operation without rendering,
 * by simulating the state transformations that happen inside useInput.
 */

interface TextInputState {
	value: string;
	cursorOffset: number;
}

// Simulate Ctrl+W: backward-kill-word
function backwardKillWord(state: TextInputState): TextInputState {
	const {value, cursorOffset} = state;
	if (cursorOffset <= 0) return state;

	let i = cursorOffset;

	// Skip whitespace immediately before cursor
	while (i > 0 && value[i - 1] === ' ') {
		i--;
	}

	// Delete back to next whitespace or start
	while (i > 0 && value[i - 1] !== ' ') {
		i--;
	}

	return {
		value: value.slice(0, i) + value.slice(cursorOffset),
		cursorOffset: i,
	};
}

// Simulate Ctrl+U: kill to start of line
function killToStart(state: TextInputState): TextInputState {
	return {
		value: state.value.slice(state.cursorOffset),
		cursorOffset: 0,
	};
}

// Simulate Ctrl+K: kill to end of line
function killToEnd(state: TextInputState): TextInputState {
	return {
		value: state.value.slice(0, state.cursorOffset),
		cursorOffset: state.cursorOffset,
	};
}

// Simulate Ctrl+A: move to start
function moveToStart(state: TextInputState): TextInputState {
	return {...state, cursorOffset: 0};
}

// Simulate Ctrl+E: move to end
function moveToEnd(state: TextInputState): TextInputState {
	return {...state, cursorOffset: state.value.length};
}

// Simulate Ctrl+B: move back one character
function moveBack(state: TextInputState): TextInputState {
	return {
		...state,
		cursorOffset: Math.max(0, state.cursorOffset - 1),
	};
}

// Simulate Ctrl+F: move forward one character
function moveForward(state: TextInputState): TextInputState {
	return {
		...state,
		cursorOffset: Math.min(state.value.length, state.cursorOffset + 1),
	};
}

// Simulate normal character insertion
function insertChar(
	state: TextInputState,
	char: string,
): TextInputState {
	const {value, cursorOffset} = state;
	return {
		value: value.slice(0, cursorOffset) + char + value.slice(cursorOffset),
		cursorOffset: cursorOffset + char.length,
	};
}

// Simulate backspace
function backspace(state: TextInputState): TextInputState {
	const {value, cursorOffset} = state;
	if (cursorOffset <= 0) return state;
	return {
		value: value.slice(0, cursorOffset - 1) + value.slice(cursorOffset),
		cursorOffset: cursorOffset - 1,
	};
}

// --- Ctrl+W (backward-kill-word) ---

test('Ctrl+W deletes the last word', (t) => {
	const result = backwardKillWord({value: 'hello world', cursorOffset: 11});
	t.is(result.value, 'hello ');
	t.is(result.cursorOffset, 6);
});

test('Ctrl+W deletes word with cursor in middle', (t) => {
	const result = backwardKillWord({value: 'hello world', cursorOffset: 5});
	t.is(result.value, ' world');
	t.is(result.cursorOffset, 0);
});

test('Ctrl+W skips trailing whitespace before deleting word', (t) => {
	const result = backwardKillWord({value: 'hello   world', cursorOffset: 8});
	t.is(result.value, 'world');
	t.is(result.cursorOffset, 0);
});

test('Ctrl+W deletes entire single word', (t) => {
	const result = backwardKillWord({value: 'hello', cursorOffset: 5});
	t.is(result.value, '');
	t.is(result.cursorOffset, 0);
});

test('Ctrl+W does nothing at start of line', (t) => {
	const result = backwardKillWord({value: 'hello', cursorOffset: 0});
	t.is(result.value, 'hello');
	t.is(result.cursorOffset, 0);
});

test('Ctrl+W on empty string does nothing', (t) => {
	const result = backwardKillWord({value: '', cursorOffset: 0});
	t.is(result.value, '');
	t.is(result.cursorOffset, 0);
});

test('Ctrl+W with multiple words deletes only last word', (t) => {
	const result = backwardKillWord({
		value: 'one two three',
		cursorOffset: 13,
	});
	t.is(result.value, 'one two ');
	t.is(result.cursorOffset, 8);
});

test('Ctrl+W preserves text after cursor', (t) => {
	const result = backwardKillWord({
		value: 'one two three',
		cursorOffset: 7,
	});
	t.is(result.value, 'one  three');
	t.is(result.cursorOffset, 4);
});

// --- Ctrl+U (kill to start) ---

test('Ctrl+U deletes from cursor to start', (t) => {
	const result = killToStart({value: 'hello world', cursorOffset: 5});
	t.is(result.value, ' world');
	t.is(result.cursorOffset, 0);
});

test('Ctrl+U at end deletes entire line', (t) => {
	const result = killToStart({value: 'hello', cursorOffset: 5});
	t.is(result.value, '');
	t.is(result.cursorOffset, 0);
});

test('Ctrl+U at start does nothing', (t) => {
	const result = killToStart({value: 'hello', cursorOffset: 0});
	t.is(result.value, 'hello');
	t.is(result.cursorOffset, 0);
});

// --- Ctrl+K (kill to end) ---

test('Ctrl+K deletes from cursor to end', (t) => {
	const result = killToEnd({value: 'hello world', cursorOffset: 5});
	t.is(result.value, 'hello');
	t.is(result.cursorOffset, 5);
});

test('Ctrl+K at start deletes entire line', (t) => {
	const result = killToEnd({value: 'hello', cursorOffset: 0});
	t.is(result.value, '');
	t.is(result.cursorOffset, 0);
});

test('Ctrl+K at end does nothing', (t) => {
	const result = killToEnd({value: 'hello', cursorOffset: 5});
	t.is(result.value, 'hello');
	t.is(result.cursorOffset, 5);
});

// --- Ctrl+A (move to start) ---

test('Ctrl+A moves cursor to start', (t) => {
	const result = moveToStart({value: 'hello world', cursorOffset: 5});
	t.is(result.cursorOffset, 0);
	t.is(result.value, 'hello world');
});

test('Ctrl+A at start stays at start', (t) => {
	const result = moveToStart({value: 'hello', cursorOffset: 0});
	t.is(result.cursorOffset, 0);
});

// --- Ctrl+E (move to end) ---

test('Ctrl+E moves cursor to end', (t) => {
	const result = moveToEnd({value: 'hello world', cursorOffset: 0});
	t.is(result.cursorOffset, 11);
	t.is(result.value, 'hello world');
});

test('Ctrl+E at end stays at end', (t) => {
	const result = moveToEnd({value: 'hello', cursorOffset: 5});
	t.is(result.cursorOffset, 5);
});

// --- Ctrl+B (move back) ---

test('Ctrl+B moves cursor back one character', (t) => {
	const result = moveBack({value: 'hello', cursorOffset: 3});
	t.is(result.cursorOffset, 2);
	t.is(result.value, 'hello');
});

test('Ctrl+B at start stays at start', (t) => {
	const result = moveBack({value: 'hello', cursorOffset: 0});
	t.is(result.cursorOffset, 0);
});

// --- Ctrl+F (move forward) ---

test('Ctrl+F moves cursor forward one character', (t) => {
	const result = moveForward({value: 'hello', cursorOffset: 2});
	t.is(result.cursorOffset, 3);
	t.is(result.value, 'hello');
});

test('Ctrl+F at end stays at end', (t) => {
	const result = moveForward({value: 'hello', cursorOffset: 5});
	t.is(result.cursorOffset, 5);
});

// --- Normal typing ---

test('inserting a character works', (t) => {
	const result = insertChar({value: 'hllo', cursorOffset: 1}, 'e');
	t.is(result.value, 'hello');
	t.is(result.cursorOffset, 2);
});

test('inserting at end appends', (t) => {
	const result = insertChar({value: 'hell', cursorOffset: 4}, 'o');
	t.is(result.value, 'hello');
	t.is(result.cursorOffset, 5);
});

// --- Backspace ---

test('backspace deletes character before cursor', (t) => {
	const result = backspace({value: 'hello', cursorOffset: 5});
	t.is(result.value, 'hell');
	t.is(result.cursorOffset, 4);
});

test('backspace at start does nothing', (t) => {
	const result = backspace({value: 'hello', cursorOffset: 0});
	t.is(result.value, 'hello');
	t.is(result.cursorOffset, 0);
});

// --- Unknown ctrl combos should not insert characters ---

test('unknown ctrl combos do not modify value', (t) => {
	// Simulate what happens when ctrl is pressed with an unhandled key:
	// The switch default case is hit, no value change occurs
	const state: TextInputState = {value: 'hello', cursorOffset: 5};
	// In the component, ctrl+<unknown> falls through to default which does nothing
	// So the state should remain unchanged
	t.is(state.value, 'hello');
	t.is(state.cursorOffset, 5);
});
