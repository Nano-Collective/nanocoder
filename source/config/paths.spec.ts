import * as path from 'path';
import test from 'ava';
import {getAppDataPath, getConfigPath} from './paths';

// These tests intentionally lock in the public contract for Nanocoder's
// configuration and data directories. Do not change expected values
// without providing a migration strategy.

console.log(`\npaths.spec.ts`);

const ORIGINAL_PLATFORM = process.platform;
const ORIGINAL_ENV = {...process.env};
// The AVA config points NANOCODER_DATA_DIR at a scratch dir so the suite never
// writes into a developer's real sessions and stats. These tests assert the
// platform defaults underneath that override, so start from it unset.
delete ORIGINAL_ENV.NANOCODER_DATA_DIR;

function setPlatform(platform: NodeJS.Platform) {
	Object.defineProperty(process, 'platform', {
		value: platform,
		configurable: true,
	});
}

function resetEnvironment() {
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

test.afterEach(() => {
	resetEnvironment();
});

function testPathGetter(
	t: import('ava').ExecutionContext,
	platform: NodeJS.Platform,
	env: Record<string, string | undefined>,
	getter: () => string,
	expected: string,
) {
	resetEnvironment();
	setPlatform(platform);
	for (const [key, value] of Object.entries(env)) {
		if (value === undefined) delete process.env[key];
		else process.env[key] = value;
	}
	t.is(getter(), expected);
}

// getAppDataPath

test.serial('getAppDataPath uses NANOCODER_DATA_DIR override verbatim', t => {
	testPathGetter(
		t,
		'linux',
		{
			NANOCODER_DATA_DIR: '/custom/data',
			APPDATA: 'C:/Ignored',
			XDG_DATA_HOME: '/ignored',
		},
		getAppDataPath,
		'/custom/data',
	);
});

test.serial('getAppDataPath darwin default path is stable', t => {
	testPathGetter(
		t,
		'darwin',
		{HOME: '/Users/test'},
		getAppDataPath,
		path.join('/Users/test', 'Library', 'Application Support', 'nanocoder'),
	);
});

test.serial('getAppDataPath win32 uses APPDATA when set', t => {
	testPathGetter(
		t,
		'win32',
		{APPDATA: path.join('C:', 'Users', 'test', 'AppData', 'Roaming')},
		getAppDataPath,
		path.join('C:', 'Users', 'test', 'AppData', 'Roaming', 'nanocoder'),
	);
});

test.serial(
	'getAppDataPath win32 falls back to homedir Roaming when APPDATA missing',
	t => {
		testPathGetter(
			t,
			'win32',
			{APPDATA: undefined, HOME: path.join('C:', 'Users', 'test')},
			getAppDataPath,
			path.join('C:', 'Users', 'test', 'AppData', 'Roaming', 'nanocoder'),
		);
	},
);

test.serial(
	'getAppDataPath linux honours XDG_DATA_HOME and ignores APPDATA',
	t => {
		testPathGetter(
			t,
			'linux',
			{XDG_DATA_HOME: '/xdg-data', APPDATA: '/should-not-be-used'},
			getAppDataPath,
			path.join('/xdg-data', 'nanocoder'),
		);
	},
);

test.serial('getAppDataPath linux falls back to ~/.local/share', t => {
	testPathGetter(
		t,
		'linux',
		{XDG_DATA_HOME: undefined, HOME: '/home/test'},
		getAppDataPath,
		path.join('/home/test', '.local', 'share', 'nanocoder'),
	);
});

test.serial(
	'getAppDataPath non-standard platform falls back to Linux-style defaults',
	t => {
		testPathGetter(
			t,
			'freebsd',
			{XDG_DATA_HOME: undefined, HOME: '/home/test'},
			getAppDataPath,
			path.join('/home/test', '.local', 'share', 'nanocoder'),
		);
	},
);

// getConfigPath

test.serial('getConfigPath uses NANOCODER_CONFIG_DIR override verbatim', t => {
	testPathGetter(
		t,
		'linux',
		{
			NANOCODER_CONFIG_DIR: '/custom/config',
			XDG_CONFIG_HOME: '/ignored',
			APPDATA: 'C:/Ignored',
		},
		getConfigPath,
		'/custom/config',
	);
});

test.serial('getConfigPath darwin default path is stable', t => {
	testPathGetter(
		t,
		'darwin',
		{NANOCODER_CONFIG_DIR: undefined, HOME: '/Users/test'},
		getConfigPath,
		path.join('/Users/test', 'Library', 'Preferences', 'nanocoder'),
	);
});

test.serial('getConfigPath win32 uses APPDATA when set', t => {
	testPathGetter(
		t,
		'win32',
		{
			NANOCODER_CONFIG_DIR: undefined,
			APPDATA: path.join('C:', 'Users', 'test', 'AppData', 'Roaming'),
		},
		getConfigPath,
		path.join('C:', 'Users', 'test', 'AppData', 'Roaming', 'nanocoder'),
	);
});

test.serial(
	'getConfigPath win32 falls back to homedir Roaming when APPDATA missing',
	t => {
		testPathGetter(
			t,
			'win32',
			{
				NANOCODER_CONFIG_DIR: undefined,
				APPDATA: undefined,
				HOME: path.join('C:', 'Users', 'test'),
			},
			getConfigPath,
			path.join('C:', 'Users', 'test', 'AppData', 'Roaming', 'nanocoder'),
		);
	},
);

test.serial(
	'getConfigPath linux honours XDG_CONFIG_HOME and ignores APPDATA',
	t => {
		testPathGetter(
			t,
			'linux',
			{
				NANOCODER_CONFIG_DIR: undefined,
				XDG_CONFIG_HOME: '/xdg-config',
				APPDATA: '/should-not-be-used',
			},
			getConfigPath,
			path.join('/xdg-config', 'nanocoder'),
		);
	},
);

test.serial('getConfigPath linux falls back to ~/.config', t => {
	testPathGetter(
		t,
		'linux',
		{
			NANOCODER_CONFIG_DIR: undefined,
			XDG_CONFIG_HOME: undefined,
			HOME: '/home/test',
		},
		getConfigPath,
		path.join('/home/test', '.config', 'nanocoder'),
	);
});

test.serial(
	'getConfigPath non-standard platform falls back to Linux-style defaults',
	t => {
		testPathGetter(
			t,
			'freebsd',
			{
				NANOCODER_CONFIG_DIR: undefined,
				XDG_CONFIG_HOME: undefined,
				HOME: '/home/test',
			},
			getConfigPath,
			path.join('/home/test', '.config', 'nanocoder'),
		);
	},
);
