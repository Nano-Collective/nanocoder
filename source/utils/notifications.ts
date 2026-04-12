import {execFile, execSync} from 'child_process';
import {existsSync} from 'fs';
import {basename, dirname, join} from 'path';
import {fileURLToPath} from 'url';
import type {NotificationsConfig} from '@/types/config';
import {logInfo} from '@/utils/message-queue';

export type NotificationEvent =
	| 'toolConfirmation'
	| 'questionPrompt'
	| 'generationComplete';

const DEFAULT_CONFIG: NotificationsConfig = {
	enabled: false,
	events: {
		toolConfirmation: true,
		questionPrompt: true,
		generationComplete: true,
	},
};

let _config: NotificationsConfig = DEFAULT_CONFIG;

export function setNotificationsConfig(config: NotificationsConfig): void {
	_config = config;
}

export function getNotificationsConfig(): NotificationsConfig {
	return _config;
}

const projectName = basename(process.cwd());

const EVENT_MESSAGES: Record<
	NotificationEvent,
	{title: string; message: string}
> = {
	toolConfirmation: {
		title: `Tool Confirmation Required in ${projectName}`,
		message: 'Nanocoder is waiting for you to approve a tool call.',
	},
	questionPrompt: {
		title: `Question From Agent in ${projectName}`,
		message: 'Nanocoder has a question and is waiting for your response.',
	},
	generationComplete: {
		title: `Response Ready in ${projectName}`,
		message: 'Nanocoder has finished generating a response.',
	},
};

// Resolve the icon path relative to this module's location
let _iconPath: string | null | undefined;
function getIconPath(): string | null {
	if (_iconPath !== undefined) {
		return _iconPath;
	}
	try {
		const __filename = fileURLToPath(import.meta.url);
		const __dirname = dirname(__filename);
		const iconPath = join(__dirname, '../../plugins/vscode/media/icon.png');
		_iconPath = existsSync(iconPath) ? iconPath : null;
	} catch {
		_iconPath = null;
	}
	return _iconPath;
}

// Check for terminal-notifier in PATH (cached)
let _terminalNotifierPath: string | null | undefined;
let _terminalNotifierHinted = false;

function getTerminalNotifierPath(): string | null {
	if (_terminalNotifierPath !== undefined) {
		return _terminalNotifierPath;
	}
	try {
		_terminalNotifierPath = execSync('which terminal-notifier', {
			encoding: 'utf-8',
			timeout: 2000,
			stdio: ['pipe', 'pipe', 'pipe'],
		}).trim();
	} catch {
		_terminalNotifierPath = null;
	}
	return _terminalNotifierPath;
}

function escapeAppleScript(str: string): string {
	return str.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function sendDarwin(title: string, message: string): void {
	const tnPath = getTerminalNotifierPath();

	if (tnPath) {
		const args = ['-title', title, '-message', message];
		const iconPath = getIconPath();
		if (iconPath) {
			args.push('-contentImage', iconPath);
		}
		if (_config.sound) {
			args.push('-sound', 'default');
		}
		execFile(tnPath, args, () => {});
		return;
	}

	// Hint once that terminal-notifier gives a better experience
	if (!_terminalNotifierHinted) {
		_terminalNotifierHinted = true;
		logInfo(
			'Install terminal-notifier for better notifications: brew install terminal-notifier',
		);
	}

	// Fallback to osascript
	const escapedTitle = escapeAppleScript(title);
	const escapedMessage = escapeAppleScript(message);
	const sound = _config.sound ? ' sound name "default"' : '';
	const script = `display notification "${escapedMessage}" with title "${escapedTitle}"${sound}`;
	execFile('osascript', ['-e', script], () => {});
}

function sendLinux(title: string, message: string): void {
	const args: string[] = [];
	const iconPath = getIconPath();
	if (iconPath) {
		args.push('-i', iconPath);
	}
	args.push(title, message);
	execFile('notify-send', args, () => {});
}

function sendWindows(title: string, message: string): void {
	const script = `
Add-Type -AssemblyName System.Windows.Forms
$notify = New-Object System.Windows.Forms.NotifyIcon
$notify.Icon = [System.Drawing.SystemIcons]::Information
$notify.BalloonTipTitle = '${title.replace(/'/g, "''")}'
$notify.BalloonTipText = '${message.replace(/'/g, "''")}'
$notify.Visible = $true
$notify.ShowBalloonTip(5000)
Start-Sleep -Seconds 1
$notify.Dispose()
`;
	execFile('powershell', ['-NoProfile', '-Command', script], () => {});
}

function sendNativeNotification(title: string, message: string): void {
	switch (process.platform) {
		case 'darwin':
			sendDarwin(title, message);
			break;
		case 'linux':
			sendLinux(title, message);
			break;
		case 'win32':
			sendWindows(title, message);
			break;
	}
}

export function sendNotification(event: NotificationEvent): void {
	if (!_config.enabled) {
		return;
	}

	if (!_config.events?.[event]) {
		return;
	}

	const {title, message} =
		_config.customMessages?.[event] ?? EVENT_MESSAGES[event];

	sendNativeNotification(title, message);
}
