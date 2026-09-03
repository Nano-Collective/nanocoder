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

// ============================================================================
// Terminal Bell Tests
// ============================================================================

const BELL = '\x07';

function capturingStdout(isTTY: boolean): {get: () => string; restore: () => void} {
	const originalWrite = process.stdout.write.bind(process.stdout);
	const originalIsTTY = process.stdout.isTTY;
	let buffer = '';
	process.stdout.isTTY = isTTY;
	// biome-ignore lint/suspicious/noExplicitAny: matching Node's overloaded write signature
	(process.stdout.write as any) = (chunk: any) => {
		buffer += typeof chunk === 'string' ? chunk : chunk.toString();
		return true;
	};
	return {
		get: () => buffer,
		restore: () => {
			process.stdout.write = originalWrite;
			process.stdout.isTTY = originalIsTTY;
		},
	};
}

function bellFor(config: NotificationsConfig, isTTY = true): string {
	setNotificationsConfig(config);
	const stdout = capturingStdout(isTTY);
	try {
		sendNotification('generationComplete');
	} finally {
		stdout.restore();
	}
	return stdout.get();
}

test.serial('sendNotification rings the terminal bell when bell is enabled', (t) => {
	const written = bellFor({
		enabled: true,
		bell: true,
		events: {generationComplete: true},
	});
	t.true(written.includes(BELL));
});

test.serial('sendNotification does not ring the bell when bell is off', (t) => {
	const written = bellFor({
		enabled: true,
		events: {generationComplete: true},
	});
	t.false(written.includes(BELL));
});

test.serial('sendNotification does not ring the bell for a disabled event', (t) => {
	const written = bellFor({
		enabled: true,
		bell: true,
		events: {generationComplete: false},
	});
	t.false(written.includes(BELL));
});

test.serial('sendNotification does not ring the bell when notifications are disabled', (t) => {
	const written = bellFor({
		enabled: false,
		bell: true,
		events: {generationComplete: true},
	});
	t.false(written.includes(BELL));
});

test.serial('sendNotification does not ring the bell when stdout is not a TTY', (t) => {
	// Piped output (CI, redirected logs) must not collect stray control chars
	const written = bellFor(
		{enabled: true, bell: true, events: {generationComplete: true}},
		false,
	);
	t.false(written.includes(BELL));
});

// Reset config after all tests
test.after.always(() => {
	setNotificationsConfig({enabled: false});
});
