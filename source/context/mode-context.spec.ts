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

test('setCurrentMode updates to yolo mode', t => {
	setCurrentMode('yolo');
	t.is(getCurrentMode(), 'yolo');

	// Reset for other tests
	setCurrentMode('normal');
});

test('mode can be switched multiple times', t => {
	setCurrentMode('normal');
	t.is(getCurrentMode(), 'normal');

	setCurrentMode('auto-accept');
	t.is(getCurrentMode(), 'auto-accept');

	setCurrentMode('yolo');
	t.is(getCurrentMode(), 'yolo');

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

// ============================================================================
// Synchronization Requirements Documentation
// ============================================================================
// IMPORTANT: The global mode context (getCurrentMode/setCurrentMode) must be
// kept in sync with React state (developmentMode from useAppState).
//
// All code paths that update developmentMode React state MUST also call
// setCurrentMode() synchronously to prevent race conditions:
//
// 1. useAppHandlers.tsx - handleToggleDevelopmentMode() (Shift+Tab toggle)
//    → Calls both setDevelopmentMode() and setCurrentModeContext() inline
//
// 2. useNonInteractiveMode.ts - Non-interactive mode activation
//    → Calls both setDevelopmentMode('auto-accept') and setCurrentModeContext('auto-accept')
//
// 3. useToolHandler.tsx - switch_mode tool execution
//    → Calls both setDevelopmentMode(mode) and setCurrentModeContext(mode)
//
// App.tsx has a backup useEffect that syncs the context on React state changes,
// but this is async and runs after render, which is too late for tool approval
// checks that happen during the same render cycle.
//
// Tool needsApproval functions (in write-file.tsx, string-replace.tsx, etc.)
// call getCurrentMode() to determine if approval is needed. If the global
// context isn't updated synchronously, tools may use stale mode values.
// ============================================================================

// Cleanup: ensure mode is reset after all tests
test.after(() => {
	setCurrentMode('normal');
});
