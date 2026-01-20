import test from 'ava';
import type {Message} from '@/types/core';
import {
	autoCompactSessionOverrides,
	resetAutoCompactSession,
	setAutoCompactEnabled,
	setAutoCompactMode,
	setAutoCompactThreshold,
} from './auto-compact.js';

// Reset session overrides before each test
test.beforeEach(() => {
	resetAutoCompactSession();
});

// ==================== Session override enabled state ====================

test('setAutoCompactEnabled sets enabled to true', t => {
	setAutoCompactEnabled(true);
	t.is(autoCompactSessionOverrides.enabled, true);
});

test('setAutoCompactEnabled sets enabled to false', t => {
	setAutoCompactEnabled(false);
	t.is(autoCompactSessionOverrides.enabled, false);
});

test('setAutoCompactEnabled sets enabled to null', t => {
	setAutoCompactEnabled(true);
	setAutoCompactEnabled(null);
	t.is(autoCompactSessionOverrides.enabled, null);
});

test('autoCompactSessionOverrides.enabled starts as null', t => {
	t.is(autoCompactSessionOverrides.enabled, null);
});

// ==================== Session override threshold ====================

test('setAutoCompactThreshold sets threshold value', t => {
	setAutoCompactThreshold(75);
	t.is(autoCompactSessionOverrides.threshold, 75);
});

test('setAutoCompactThreshold clamps to minimum of 50', t => {
	setAutoCompactThreshold(30);
	t.is(autoCompactSessionOverrides.threshold, 50);
});

test('setAutoCompactThreshold clamps to maximum of 95', t => {
	setAutoCompactThreshold(99);
	t.is(autoCompactSessionOverrides.threshold, 95);
});

test('setAutoCompactThreshold handles boundary value 50', t => {
	setAutoCompactThreshold(50);
	t.is(autoCompactSessionOverrides.threshold, 50);
});

test('setAutoCompactThreshold handles boundary value 95', t => {
	setAutoCompactThreshold(95);
	t.is(autoCompactSessionOverrides.threshold, 95);
});

test('setAutoCompactThreshold sets threshold to null', t => {
	setAutoCompactThreshold(75);
	setAutoCompactThreshold(null);
	t.is(autoCompactSessionOverrides.threshold, null);
});

test('autoCompactSessionOverrides.threshold starts as null', t => {
	t.is(autoCompactSessionOverrides.threshold, null);
});

// ==================== Session override mode ====================

test('setAutoCompactMode sets mode to aggressive', t => {
	setAutoCompactMode('aggressive');
	t.is(autoCompactSessionOverrides.mode, 'aggressive');
});

test('setAutoCompactMode sets mode to conservative', t => {
	setAutoCompactMode('conservative');
	t.is(autoCompactSessionOverrides.mode, 'conservative');
});

test('setAutoCompactMode sets mode to default', t => {
	setAutoCompactMode('default');
	t.is(autoCompactSessionOverrides.mode, 'default');
});

test('setAutoCompactMode sets mode to null', t => {
	setAutoCompactMode('aggressive');
	setAutoCompactMode(null);
	t.is(autoCompactSessionOverrides.mode, null);
});

test('autoCompactSessionOverrides.mode starts as null', t => {
	t.is(autoCompactSessionOverrides.mode, null);
});

// ==================== Reset functionality ====================

test('resetAutoCompactSession resets all overrides to null', t => {
	setAutoCompactEnabled(true);
	setAutoCompactThreshold(80);
	setAutoCompactMode('aggressive');

	resetAutoCompactSession();

	t.is(autoCompactSessionOverrides.enabled, null);
	t.is(autoCompactSessionOverrides.threshold, null);
	t.is(autoCompactSessionOverrides.mode, null);
});

// ==================== Proxy compatibility ====================

test('autoCompactSessionOverrides proxy allows setting enabled', t => {
	autoCompactSessionOverrides.enabled = true;
	t.is(autoCompactSessionOverrides.enabled, true);

	autoCompactSessionOverrides.enabled = false;
	t.is(autoCompactSessionOverrides.enabled, false);
});

test('autoCompactSessionOverrides proxy allows setting threshold', t => {
	autoCompactSessionOverrides.threshold = 70;
	t.is(autoCompactSessionOverrides.threshold, 70);
});

test('autoCompactSessionOverrides proxy allows setting mode', t => {
	autoCompactSessionOverrides.mode = 'conservative';
	t.is(autoCompactSessionOverrides.mode, 'conservative');
});

// ==================== Combined scenarios ====================

test('multiple session overrides can be set independently', t => {
	setAutoCompactEnabled(false);
	setAutoCompactThreshold(60);
	setAutoCompactMode('conservative');

	t.is(autoCompactSessionOverrides.enabled, false);
	t.is(autoCompactSessionOverrides.threshold, 60);
	t.is(autoCompactSessionOverrides.mode, 'conservative');

	// Change one without affecting others
	setAutoCompactEnabled(true);

	t.is(autoCompactSessionOverrides.enabled, true);
	t.is(autoCompactSessionOverrides.threshold, 60);
	t.is(autoCompactSessionOverrides.mode, 'conservative');
});

test('partial reset scenario - set some, reset all, set different', t => {
	setAutoCompactEnabled(true);
	setAutoCompactThreshold(85);

	resetAutoCompactSession();

	setAutoCompactMode('aggressive');

	t.is(autoCompactSessionOverrides.enabled, null);
	t.is(autoCompactSessionOverrides.threshold, null);
	t.is(autoCompactSessionOverrides.mode, 'aggressive');
});
