import childProcess from 'child_process';
import test from 'ava';
import {
	buildWindowsNotificationPayload,
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
// Windows Notification Tests & Security Verification
// ============================================================================

test.serial(
	'buildWindowsNotificationPayload generates static script and out-of-band env vars',
	(t) => {
		const title = 'Test Title `whoami` & $env:TEMP';
		const message = 'Line 1\nLine 2 with "quotes" and \'single quotes\' 🚀';

		const payload = buildWindowsNotificationPayload(title, message);

		t.is(payload.command, 'powershell');
		t.is(payload.args[0], '-NoProfile');
		t.is(payload.args[1], '-NonInteractive');
		t.is(payload.args[2], '-EncodedCommand');
		t.true(payload.options.windowsHide);

		// Verify encoded script decodes properly and does not interpolate user strings
		const decodedScript = Buffer.from(payload.args[3], 'base64').toString(
			'utf16le',
		);
		t.true(decodedScript.includes('System.Windows.Forms.NotifyIcon'));
		t.true(decodedScript.includes('$env:NANOCODER_NOTIFICATION_TITLE'));
		t.true(decodedScript.includes('$env:NANOCODER_NOTIFICATION_MESSAGE'));

		// Verify title and message env vars are passed verbatim
		t.is(payload.options.env.NANOCODER_NOTIFICATION_TITLE, title);
		t.is(payload.options.env.NANOCODER_NOTIFICATION_MESSAGE, message);
	},
);

test.serial(
	'buildWindowsNotificationPayload safely preserves edge case characters in env vars',
	(t) => {
		const injectionTitles = [
			'`whoami`',
			'$(Get-Process)',
			'$env:USERPROFILE',
			"'; Remove-Item -Recurse C:\\; '",
			'Title with "double quotes" and \'single quotes\'',
			'Emoji 🚀 and Unicode 你好世界',
		];

		for (const title of injectionTitles) {
			const payload = buildWindowsNotificationPayload(title, 'sample message');

			// Payload env var must match exact literal text
			t.is(payload.options.env.NANOCODER_NOTIFICATION_TITLE, title);
		}
	},
);

test.serial(
	'sendNotification handles win32 platform gracefully and invokes static powershell command',
	(t) => {
		const originalPlatform = process.platform;
		const originalExecFile = childProcess.execFile;
		let executedCommand = '';
		let executedArgs: string[] = [];
		let executedOptions: {windowsHide?: boolean; env?: NodeJS.ProcessEnv} = {};

		// Spy on childProcess.execFile
		// biome-ignore lint/suspicious/noExplicitAny: test stub
		(childProcess.execFile as any) = (
			command: string,
			args: string[],
			options: any,
			callback: any,
		) => {
			executedCommand = command;
			executedArgs = args;
			executedOptions = options;
			if (typeof options === 'function') {
				options();
			} else if (typeof callback === 'function') {
				callback();
			}
		};

		Object.defineProperty(process, 'platform', {
			value: 'win32',
			configurable: true,
		});

		try {
			setNotificationsConfig({
				enabled: true,
				events: {generationComplete: true},
				customMessages: {
					generationComplete: {
						title: '`whoami`',
						message: 'Test message $(dir)',
					},
				},
			});

			t.notThrows(() => sendNotification('generationComplete'));

			t.is(executedCommand, 'powershell');
			t.is(executedArgs[0], '-NoProfile');
			t.is(executedArgs[1], '-NonInteractive');
			t.is(executedArgs[2], '-EncodedCommand');
			t.true(executedOptions.windowsHide);
			t.is(executedOptions.env?.NANOCODER_NOTIFICATION_TITLE, '`whoami`');
			t.is(
				executedOptions.env?.NANOCODER_NOTIFICATION_MESSAGE,
				'Test message $(dir)',
			);
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
