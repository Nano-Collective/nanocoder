import {homedir} from 'node:os';
import * as path from 'node:path';
import test from 'ava';
import {getCachePath, getLogPath} from './platform-dirs';

// getAppDataPath and getConfigPath are pinned in paths.spec.ts, which
// imports them through config/paths.

console.log('\nplatform-dirs.spec.ts');

const ORIGINAL_PLATFORM = process.platform;
const ORIGINAL_ENV = {...process.env};

function withEnvironment(
	platform: NodeJS.Platform,
	env: Record<string, string | undefined>,
	run: () => void,
) {
	Object.defineProperty(process, 'platform', {
		value: platform,
		configurable: true,
	});
	for (const key of [
		'NANOCODER_LOG_DIR',
		'XDG_STATE_HOME',
		'XDG_CACHE_HOME',
		'LOCALAPPDATA',
	]) {
		delete process.env[key];
	}
	for (const [key, value] of Object.entries(env)) {
		if (value !== undefined) process.env[key] = value;
	}
	try {
		run();
	} finally {
		for (const key of Object.keys(process.env)) {
			if (!(key in ORIGINAL_ENV)) delete process.env[key];
		}
		for (const [key, value] of Object.entries(ORIGINAL_ENV)) {
			process.env[key] = value as string;
		}
		Object.defineProperty(process, 'platform', {
			value: ORIGINAL_PLATFORM,
			configurable: true,
		});
	}
}

const home = homedir();

test.serial('getLogPath honours NANOCODER_LOG_DIR on every platform', t => {
	for (const platform of ['darwin', 'linux', 'win32'] as const) {
		withEnvironment(platform, {NANOCODER_LOG_DIR: '/custom/logs'}, () => {
			t.is(getLogPath(), '/custom/logs');
		});
	}
});

test.serial('getLogPath keeps its per-platform defaults', t => {
	withEnvironment('darwin', {}, () => {
		t.is(getLogPath(), path.join(home, 'Library', 'Logs', 'nanocoder'));
	});
	withEnvironment('linux', {}, () => {
		t.is(
			getLogPath(),
			path.join(home, '.local', 'state', 'nanocoder', 'logs'),
		);
	});
	withEnvironment('linux', {XDG_STATE_HOME: '/state'}, () => {
		t.is(getLogPath(), path.join('/state', 'nanocoder', 'logs'));
	});
	withEnvironment('win32', {LOCALAPPDATA: 'C:\\Local'}, () => {
		t.is(getLogPath(), path.join('C:\\Local', 'nanocoder', 'logs'));
	});
	withEnvironment('win32', {}, () => {
		t.is(
			getLogPath(),
			path.join(home, 'AppData', 'Local', 'nanocoder', 'logs'),
		);
	});
});

test.serial('getCachePath honours XDG_CACHE_HOME on every platform', t => {
	for (const platform of ['darwin', 'linux', 'win32'] as const) {
		withEnvironment(platform, {XDG_CACHE_HOME: '/xdg-cache'}, () => {
			t.is(getCachePath(), path.join('/xdg-cache', 'nanocoder'));
		});
	}
});

test.serial('getCachePath uses each platform cache directory by default', t => {
	withEnvironment('darwin', {}, () => {
		t.is(getCachePath(), path.join(home, 'Library', 'Caches', 'nanocoder'));
	});
	withEnvironment('linux', {}, () => {
		t.is(getCachePath(), path.join(home, '.cache', 'nanocoder'));
	});
	withEnvironment('win32', {LOCALAPPDATA: 'C:\\Local'}, () => {
		t.is(getCachePath(), path.join('C:\\Local', 'nanocoder', 'cache'));
	});
	withEnvironment('win32', {}, () => {
		t.is(
			getCachePath(),
			path.join(home, 'AppData', 'Local', 'nanocoder', 'cache'),
		);
	});
});
