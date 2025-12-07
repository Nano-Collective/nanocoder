import test from 'ava';
import {getCurrentMode, setCurrentMode} from './mode-context.js';

// ============================================================================
// Tests for Mode Context
// ============================================================================
// The mode context is critical for v6 needsApproval logic. These tests ensure
// that mode state management works correctly across the application.

test('getCurrentMode returns default mode (normal)', t => {
	// After module initialization, mode should be 'normal'
	const mode = getCurrentMode();
	t.is(mode, 'normal');
});

test('setCurrentMode updates to auto-accept mode', t => {
	setCurrentMode('auto-accept');
	t.is(getCurrentMode(), 'auto-accept');

	// Reset for other tests
	setCurrentMode('normal');
});

test('setCurrentMode updates to plan mode', t => {
	setCurrentMode('plan');
	t.is(getCurrentMode(), 'plan');

	// Reset for other tests
	setCurrentMode('normal');
});

test('setCurrentMode updates to normal mode', t => {
	setCurrentMode('auto-accept');
	t.is(getCurrentMode(), 'auto-accept');

	setCurrentMode('normal');
	t.is(getCurrentMode(), 'normal');
});

test('mode persists across multiple getCurrentMode calls', t => {
	setCurrentMode('auto-accept');
	t.is(getCurrentMode(), 'auto-accept');
	t.is(getCurrentMode(), 'auto-accept');
	t.is(getCurrentMode(), 'auto-accept');

	setCurrentMode('normal');
});

test('mode can be switched multiple times', t => {
	setCurrentMode('normal');
	t.is(getCurrentMode(), 'normal');

	setCurrentMode('auto-accept');
	t.is(getCurrentMode(), 'auto-accept');

	setCurrentMode('plan');
	t.is(getCurrentMode(), 'plan');

	setCurrentMode('normal');
	t.is(getCurrentMode(), 'normal');
});

test('mode changes are immediate', t => {
	const before = getCurrentMode();

	setCurrentMode('auto-accept');
	const after = getCurrentMode();

	t.not(before, after);
	t.is(after, 'auto-accept');

	// Reset
	setCurrentMode('normal');
});

// Cleanup: ensure mode is reset after all tests
test.after(() => {
	setCurrentMode('normal');
});
