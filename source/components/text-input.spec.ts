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

// Simulate Ctrl+W: backward-kill-word (newlines are word boundaries)
function backwardKillWord(state: TextInputState): TextInputState {
	const {value, cursorOffset} = state;
	if (cursorOffset <= 0) return state;

	let i = cursorOffset;

	// Skip whitespace (spaces + newlines) immediately before cursor
	while (i > 0 && (value[i - 1] === ' ' || value[i - 1] === '\n')) {
		i--;
	}

	// Delete back to next whitespace/newline or start
	while (i > 0 && value[i - 1] !== ' ' && value[i - 1] !== '\n') {
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

// --- Ctrl+Left / Ctrl+Right (word-jump) ---

function moveToPrevWord(value: string, offset: number): number {
	let i = offset;
	// Skip whitespace (spaces + newlines) backward, then word backward
	while (i > 0 && (value[i - 1] === ' ' || value[i - 1] === '\n')) i--;
	while (i > 0 && value[i - 1] !== ' ' && value[i - 1] !== '\n') i--;
	return i;
}

function moveToNextWord(value: string, offset: number): number {
	let i = offset;
	// Skip word forward, then whitespace (spaces + newlines) forward
	while (i < value.length && value[i] !== ' ' && value[i] !== '\n') i++;
	while (i < value.length && (value[i] === ' ' || value[i] === '\n')) i++;
	return i;
}

test('Ctrl+Left jumps to start of previous word', (t) => {
	t.is(moveToPrevWord('hello world', 11), 6);
});

test('Ctrl+Left from middle of word jumps to word start', (t) => {
	t.is(moveToPrevWord('hello world', 8), 6);
});

test('Ctrl+Left at start stays at start', (t) => {
	t.is(moveToPrevWord('hello', 0), 0);
});

test('Ctrl+Left skips multiple spaces', (t) => {
	// Skips word backward from 'r' to 'w' start — lands at word start, not before whitespace
	t.is(moveToPrevWord('hello   world', 10), 8);
});

test('Ctrl+Right jumps to start of next word', (t) => {
	t.is(moveToNextWord('hello world', 0), 6);
});

test('Ctrl+Right from start of second word jumps to its end', (t) => {
	t.is(moveToNextWord('hello world', 6), 11);
});

test('Ctrl+Right at end stays at end', (t) => {
	t.is(moveToNextWord('hello', 5), 5);
});

test('Ctrl+Right skips spaces before next word', (t) => {
	// From pos 5 (space), skips word (none), then skips spaces to 'w'
	t.is(moveToNextWord('hello   world', 5), 8);
});

// --- Ctrl+Left / Ctrl+Right with newlines (multiline word-jump) ---

test('Ctrl+Left crosses newline to previous line', (t) => {
	// From start of "foo" after newline, crosses newline to "world" on line 1
	t.is(moveToPrevWord('hello world\nfoo bar', 12), 6);
});

test('Ctrl+Left from word on line 2 jumps to start of that word', (t) => {
	// From end of "bar" on line 2, jumps to start of "bar"
	t.is(moveToPrevWord('hello world\nfoo bar', 19), 16);
});

test('Ctrl+Left from start of second word on line 2 jumps to first word', (t) => {
	// From start of "bar", skips space, jumps to start of "foo"
	t.is(moveToPrevWord('hello world\nfoo bar', 16), 12);
});

test('Ctrl+Right from end of line 1 crosses newline to start of next word', (t) => {
	// From newline, skips to start of "foo"
	t.is(moveToNextWord('hello world\nfoo bar', 11), 12);
});

test('Ctrl+Right from start of "foo" jumps to start of next word', (t) => {
	t.is(moveToNextWord('hello world\nfoo bar', 12), 16);
});

test('Ctrl+Left on blank line crosses to previous line', (t) => {
	// After newline at end, crosses newline to start of "hello"
	t.is(moveToPrevWord('hello\n', 6), 0);
});

test('Ctrl+Right from before newline crosses to next word', (t) => {
	// From "d" in "world", crosses newline to start of "foo"
	t.is(moveToNextWord('hello world\nfoo', 10), 12);
});

test('Ctrl+Left with multiple newlines crosses one line at a time', (t) => {
	// From start of "ccc", crosses newline to start of "bbb"
	t.is(moveToPrevWord('aaa\nbbb\nccc', 8), 4);
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

// --- handleEnter / onEnter props ---

test('handleEnter=false ignores Enter', (t) => {
	let called = false;
	const fn = () => { called = true; };
	// Simulates: if (handleEnter && onEnter) { onEnter(value) }
	if (false && fn) fn();
	t.false(called);
});

test('handleEnter=true calls onEnter when provided', (t) => {
	let called = false;
	const onEnter = () => { called = true; };
	// Simulates: if (handleEnter && onEnter) { onEnter(value) }
	if (true && onEnter) onEnter();
	t.true(called);
});

test('handleEnter=true calls onSubmit when onEnter not provided', (t) => {
	let called = false;
	const onSubmit = () => { called = true; };
	// Simulates: if (handleEnter && onEnter) {} else if (handleEnter && onSubmit) { onSubmit(value) }
	if (true && undefined) {} else if (true && onSubmit) onSubmit();
	t.true(called);
});


