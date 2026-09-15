import childProcess from 'child_process';
import test from 'ava';
import {
	buildDarwinNotificationArgs,
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
// macOS / Darwin Notification Tests
// ============================================================================

test.serial(
	'buildDarwinNotificationArgs generates static script and out-of-band arguments',
	(t) => {
		const title = 'Test Title with "quotes" & \\backslashes';
		const message = 'Line 1\nLine 2 with special $chars and `backticks` 🚀';

		const args = buildDarwinNotificationArgs(title, message, false);

		t.is(args[0], '-e');
		t.true(args[1].includes('on run argv'));
		t.true(
			args[1].includes(
				'display notification (item 2 of argv) with title (item 1 of argv)',
			),
		);
		t.false(args[1].includes('sound name'));
		t.is(args[2], title);
		t.is(args[3], message);
	},
);

test.serial(
	'buildDarwinNotificationArgs supports optional sound parameter',
	(t) => {
		const args = buildDarwinNotificationArgs('Title', 'Message', true);
		t.true(args[1].includes('sound name "default"'));
	},
);

test.serial(
	'buildDarwinNotificationArgs safely preserves newlines, quotes, backslashes and unicode',
	(t) => {
		const testCases = [
			{
				title: 'Title with\nmultiple\nnewlines',
				message: 'Message with\r\nnewlines and \ttabs',
			},
			{
				title: 'Title with "double" and \'single\' quotes and `backticks`',
				message: 'Message with "double" and \'single\' quotes and `backticks`',
			},
			{
				title: 'Title with \\ backslashes \\\\ and $variables',
				message: 'Message with \\ backslashes \\\\ and $variables',
			},
			{
				title: '🚀 Emoji and Unicode 你好世界',
				message: 'Message with 🌟 emoji and Special Unicode: äöüß',
			},
		];

		for (const tc of testCases) {
			const args = buildDarwinNotificationArgs(tc.title, tc.message);
			t.is(args[2], tc.title);
			t.is(args[3], tc.message);
		}
	},
);

test.serial(
	'sendNotification handles darwin platform gracefully and invokes osascript with out-of-band args',
	(t) => {
		const originalPlatform = process.platform;
		const originalExecFile = childProcess.execFile;
		let executedCommand = '';
		let executedArgs: string[] = [];

		// Spy on childProcess.execFile
		// biome-ignore lint/suspicious/noExplicitAny: test stub
		(childProcess.execFile as any) = (
			command: string,
			args: string[],
			optionsOrCallback: any,
			callback?: any,
		) => {
			executedCommand = command;
			executedArgs = args;
			const cb = typeof optionsOrCallback === 'function' ? optionsOrCallback : callback;
			if (typeof cb === 'function') {
				cb(null, '', '');
			}
		};

		Object.defineProperty(process, 'platform', {
			value: 'darwin',
			configurable: true,
		});

		try {
			setNotificationsConfig({
				enabled: true,
				sound: true,
				events: {generationComplete: true},
				customMessages: {
					generationComplete: {
						title: 'Darwin Title with\nnewlines & "quotes"',
						message: 'Darwin Message with\nnewlines & "quotes" 🚀',
					},
				},
			});

			t.notThrows(() => sendNotification('generationComplete'));

			// On systems without terminal-notifier, it falls back to osascript with positional args
			if (executedCommand === 'osascript') {
				t.is(executedArgs[0], '-e');
				t.true(executedArgs[1].includes('on run argv'));
				t.true(executedArgs[1].includes('sound name "default"'));
				t.is(executedArgs[2], 'Darwin Title with\nnewlines & "quotes"');
				t.is(executedArgs[3], 'Darwin Message with\nnewlines & "quotes" 🚀');
			} else {
				// terminal-notifier was detected on the host
				t.true(executedArgs.includes('-title'));
				t.true(executedArgs.includes('Darwin Title with\nnewlines & "quotes"'));
				t.true(executedArgs.includes('-message'));
				t.true(executedArgs.includes('Darwin Message with\nnewlines & "quotes" 🚀'));
			}
		} finally {
			childProcess.execFile = originalExecFile;
			Object.defineProperty(process, 'platform', {
				value: originalPlatform,
				configurable: true,
			});
		}
	},
);

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
