import test from 'ava';
import {
	getNotificationsConfig,
	sendNotification,
	setNotificationsConfig,
} from './notifications';
import type {NotificationsConfig} from '@/types/config';

console.log('\nnotifications.spec.ts');

// ============================================================================
// setNotificationsConfig / getNotificationsConfig Tests
// ============================================================================

test.serial('getNotificationsConfig returns default config initially', (t) => {
	const config = getNotificationsConfig();
	t.false(config.enabled);
	t.true(config.events?.toolConfirmation);
	t.true(config.events?.questionPrompt);
	t.true(config.events?.generationComplete);
});

test.serial('setNotificationsConfig updates config', (t) => {
	const custom: NotificationsConfig = {
		enabled: true,
		sound: true,
		events: {
			toolConfirmation: true,
			questionPrompt: false,
			generationComplete: true,
		},
	};
	setNotificationsConfig(custom);
	const config = getNotificationsConfig();
	t.true(config.enabled);
	t.true(config.sound);
	t.false(config.events?.questionPrompt);
});

// ============================================================================
// sendNotification Tests
// ============================================================================

test.serial('sendNotification does nothing when disabled', (t) => {
	setNotificationsConfig({enabled: false});
	// Should not throw — silently returns
	t.notThrows(() => sendNotification('toolConfirmation'));
	t.notThrows(() => sendNotification('questionPrompt'));
	t.notThrows(() => sendNotification('generationComplete'));
});

test.serial('sendNotification does nothing when event is disabled', (t) => {
	setNotificationsConfig({
		enabled: true,
		events: {
			toolConfirmation: false,
			questionPrompt: false,
			generationComplete: false,
		},
	});
	t.notThrows(() => sendNotification('toolConfirmation'));
	t.notThrows(() => sendNotification('questionPrompt'));
	t.notThrows(() => sendNotification('generationComplete'));
});

test.serial(
	'sendNotification does not throw when enabled with valid event',
	(t) => {
		setNotificationsConfig({
			enabled: true,
			events: {
				toolConfirmation: true,
				questionPrompt: true,
				generationComplete: true,
			},
		});
		// These will attempt to fire native notifications (fire-and-forget)
		// so they should not throw regardless of platform
		t.notThrows(() => sendNotification('toolConfirmation'));
		t.notThrows(() => sendNotification('questionPrompt'));
		t.notThrows(() => sendNotification('generationComplete'));
	},
);

test.serial('sendNotification uses custom messages when provided', (t) => {
	setNotificationsConfig({
		enabled: true,
		events: {
			toolConfirmation: true,
		},
		customMessages: {
			toolConfirmation: {
				title: 'Custom Title',
				message: 'Custom message body',
			},
		},
	});
	// Should not throw — custom messages are used internally
	t.notThrows(() => sendNotification('toolConfirmation'));
});

test.serial('sendNotification handles undefined events gracefully', (t) => {
	setNotificationsConfig({
		enabled: true,
		// No events specified — should treat as falsy
	});
	t.notThrows(() => sendNotification('toolConfirmation'));
});

// Reset config after all tests
test.after.always(() => {
	setNotificationsConfig({enabled: false});
});
