import {mkdirSync, rmSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import test from 'ava';
import {profileCommand} from '@/commands/profile';
import {resolveEffectiveConfig} from '@/config/effective-config';
import {
	clearAppConfig,
	clearProfileCache,
	getAppConfig,
	getActiveProfile,
	getActiveProfileName,
	getCliProfile,
	loadAvailableProfiles,
	loadDefaultMode,
	loadDefaultProfileName,
	reloadAppConfig,
	resolveActiveProfile,
	setActiveProfile,
	setCliProfile,
} from '@/config/index';
import {resolveStartupProvider} from '@/hooks/startup-provider';
import type {CommandContext} from '@/types/index';

const testDir = join(process.cwd(), '.test-profile-' + Date.now());
const projectDir = join(testDir, 'project');
const globalDir = join(testDir, 'global');

test.before(() => {
	mkdirSync(projectDir, {recursive: true});
	mkdirSync(globalDir, {recursive: true});
});

test.after.always(() => {
	rmSync(testDir, {recursive: true, force: true});
});

test.beforeEach(() => {
	clearProfileCache();
	clearAppConfig();
	delete process.env.NANOCODER_PROFILE;
	delete process.env.NANOCODER_CONFIG_DIR;
});

test.afterEach(() => {
	clearProfileCache();
	clearAppConfig();
	delete process.env.NANOCODER_PROFILE;
	delete process.env.NANOCODER_CONFIG_DIR;
});

test.serial('setCliProfile and getCliProfile manage the CLI profile name', t => {
	t.is(getCliProfile(), undefined);
	setCliProfile('fast');
	t.is(getCliProfile(), 'fast');
	setCliProfile('   ');
	t.is(getCliProfile(), undefined);
	setCliProfile('review');
	t.is(getCliProfile(), 'review');
	clearProfileCache();
	t.is(getCliProfile(), undefined);
});

test.serial(
	'profile selection precedence: CLI flag > NANOCODER_PROFILE > defaultProfile',
	t => {
		const projectAgents = {
			nanocoder: {
				defaultProfile: 'config-default',
				profiles: {
					'config-default': {provider: 'ollama', model: 'llama3'},
					'env-profile': {provider: 'openrouter', model: 'claude-3'},
					'cli-profile': {provider: 'openai', model: 'gpt-4o'},
				},
			},
		};
		writeFileSync(
			join(projectDir, 'agents.config.json'),
			JSON.stringify(projectAgents, null, 2),
		);

		// 1. None of CLI / env set -> picks defaultProfile
		t.is(getActiveProfileName(projectDir), 'config-default');
		t.is(resolveActiveProfile(projectDir)?.name, 'config-default');

		// 2. NANOCODER_PROFILE set -> beats defaultProfile
		process.env.NANOCODER_PROFILE = 'env-profile';
		t.is(getActiveProfileName(projectDir), 'env-profile');
		t.is(resolveActiveProfile(projectDir)?.name, 'env-profile');

		// 3. CLI flag set -> beats NANOCODER_PROFILE
		setCliProfile('cli-profile');
		t.is(getActiveProfileName(projectDir), 'cli-profile');
		t.is(resolveActiveProfile(projectDir)?.name, 'cli-profile');
	},
);

test.serial('loadAvailableProfiles merges global and project profiles', t => {
	const globalAgents = {
		nanocoder: {
			profiles: {
				shared: {model: 'global-model', provider: 'global-provider'},
				globalOnly: {model: 'g-model'},
			},
		},
	};
	const projectAgents = {
		nanocoder: {
			profiles: {
				shared: {model: 'project-model', provider: 'project-provider'},
				projectOnly: {model: 'p-model'},
			},
		},
	};

	process.env.NANOCODER_CONFIG_DIR = globalDir;
	writeFileSync(
		join(globalDir, 'agents.config.json'),
		JSON.stringify(globalAgents),
	);
	writeFileSync(
		join(projectDir, 'agents.config.json'),
		JSON.stringify(projectAgents),
	);

	const available = loadAvailableProfiles(projectDir);
	t.truthy(available.shared);
	t.truthy(available.globalOnly);
	t.truthy(available.projectOnly);
	// Project profile overrides global on name collision
	t.is(available.shared.model, 'project-model');
	t.is(available.shared.provider, 'project-provider');
});

test.serial('loadDefaultProfileName prefers project over global', t => {
	process.env.NANOCODER_CONFIG_DIR = globalDir;
	writeFileSync(
		join(globalDir, 'agents.config.json'),
		JSON.stringify({nanocoder: {defaultProfile: 'global-def'}}),
	);
	writeFileSync(
		join(projectDir, 'agents.config.json'),
		JSON.stringify({nanocoder: {defaultProfile: 'project-def'}}),
	);

	t.is(loadDefaultProfileName(projectDir), 'project-def');
});

test.serial('unknown profile fails fast with list of available profiles', t => {
	const projectAgents = {
		nanocoder: {
			profiles: {
				dev: {provider: 'ollama'},
				review: {mode: 'plan'},
			},
		},
	};
	writeFileSync(
		join(projectDir, 'agents.config.json'),
		JSON.stringify(projectAgents),
	);

	setCliProfile('nonexistent');
	const error = t.throws(() => resolveActiveProfile(projectDir), {
		message: /Unknown profile "nonexistent"\. Available profiles: dev, review/,
	});
	t.truthy(error);
});

test.serial(
	'unknown profile fails fast stating none configured when profiles empty',
	t => {
		writeFileSync(
			join(projectDir, 'agents.config.json'),
			JSON.stringify({nanocoder: {}}),
		);

		setCliProfile('fast');
		const error = t.throws(() => resolveActiveProfile(projectDir), {
			message:
				/Unknown profile "fast"\. No profiles are configured in agents\.config\.json\./,
		});
		t.truthy(error);
	},
);

test.serial(
	'active profile overrides section configurations in getAppConfig and loadDefaultMode',
	t => {
		const projectAgents = {
			nanocoder: {
				defaultMode: 'normal',
				disabledTools: ['bash'],
				retries: {maxEmptyTurns: 2},
				profiles: {
					hardened: {
						mode: 'plan',
						disabledTools: ['bash', 'write_file'],
						retries: {maxEmptyTurns: 10},
						tune: {toolProfile: 'minimal'},
					},
				},
			},
		};
		writeFileSync(
			join(projectDir, 'agents.config.json'),
			JSON.stringify(projectAgents),
		);

		setCliProfile('hardened');
		const profile = getActiveProfile(projectDir);
		t.is(profile?.mode, 'plan');
		t.deepEqual(profile?.disabledTools, ['bash', 'write_file']);
		t.is(profile?.retries?.maxEmptyTurns, 10);
	},
);

test.serial(
	'resolveStartupProvider respects profileProvider with proper precedence',
	t => {
		const configured = ['ollama', 'openai', 'anthropic'];

		// profileProvider used when cliProvider and modeProvider not set
		const res1 = resolveStartupProvider(
			undefined,
			undefined,
			'openai',
			configured,
			'ollama',
		);
		t.is(res1.provider, 'ollama');

		// cliProvider beats profileProvider
		const res2 = resolveStartupProvider(
			'anthropic',
			undefined,
			'openai',
			configured,
			'ollama',
		);
		t.is(res2.provider, 'anthropic');

		// profileProvider beats modeProvider
		const res3 = resolveStartupProvider(
			undefined,
			'openai',
			'anthropic',
			configured,
			'ollama',
		);
		t.is(res3.provider, 'ollama');

		// Stale profileProvider falls back with staleName
		const res4 = resolveStartupProvider(
			undefined,
			undefined,
			'openai',
			configured,
			'nonexistent-provider',
		);
		t.is(res4.provider, undefined);
		t.is(res4.staleName, 'nonexistent-provider');
	},
);

test.serial('/profile slash command lists profiles and switches active profile', async t => {
	const projectAgents = {
		nanocoder: {
			profiles: {
				fast: {provider: 'ollama', model: 'qwen2.5:7b', mode: 'normal'},
				review: {mode: 'plan', disabledTools: ['write_file']},
			},
		},
	};
	process.env.NANOCODER_CONFIG_DIR = globalDir;
	writeFileSync(
		join(globalDir, 'agents.config.json'),
		JSON.stringify(projectAgents),
	);

	const messages: unknown[] = [];
	let switchedTo: {provider: string; model: string} | undefined;
	const context: Partial<CommandContext> = {
		args: [],
		argText: '',
		provider: 'default-provider',
		model: 'default-model',
		addToChatQueue: msg => messages.push(msg),
		switchModel: async (p, m) => {
			switchedTo = {provider: p, model: m};
			return true;
		},
	};

	// 1. Run /profile with no args -> lists profiles
	const resList = await profileCommand.run(context as CommandContext);
	t.is(resList, 'done');
	t.is(messages.length, 1);

	// 2. Run /profile with unknown name -> error message
	messages.length = 0;
	context.args = ['unknown'];
	context.argText = 'unknown';
	const resUnknown = await profileCommand.run(context as CommandContext);
	t.is(resUnknown, 'done');
	t.is(messages.length, 1);

	// 3. Run /profile fast -> switches profile, calls switchModel
	messages.length = 0;
	context.args = ['fast'];
	context.argText = 'fast';
	const resSwitch = await profileCommand.run(context as CommandContext);
	t.is(resSwitch, 'done');
	t.is(getCliProfile(), 'fast');
	t.deepEqual(switchedTo, {provider: 'ollama', model: 'qwen2.5:7b'});
});

test.serial(
	'unknown profile fails fast on prototype property like constructor',
	t => {
		const projectAgents = {
			nanocoder: {
				profiles: {
					fast: {provider: 'ollama'},
				},
			},
		};
		writeFileSync(
			join(projectDir, 'agents.config.json'),
			JSON.stringify(projectAgents, null, 2),
		);
		setCliProfile('constructor');
		const error = t.throws(() => resolveActiveProfile(projectDir), {
			message: /Unknown profile "constructor"\. Available profiles: fast/,
		});
		t.truthy(error);
	},
);

test.serial(
	'setActiveProfile(undefined) clears active profile and overrides env and defaultProfile',
	t => {
		const projectAgents = {
			nanocoder: {
				defaultProfile: 'config-default',
				profiles: {
					'config-default': {provider: 'ollama'},
				},
			},
		};
		writeFileSync(
			join(projectDir, 'agents.config.json'),
			JSON.stringify(projectAgents, null, 2),
		);
		process.env.NANOCODER_PROFILE = 'config-default';

		t.is(getActiveProfileName(projectDir), 'config-default');
		setActiveProfile(undefined, projectDir);
		t.is(getActiveProfileName(projectDir), undefined);
		t.is(resolveActiveProfile(projectDir), undefined);
	},
);

test.serial(
	'loadAvailableProfiles tolerates a UTF-8 BOM in agents.config.json',
	t => {
		const projectAgents = {
			nanocoder: {
				profiles: {
					bomProfile: {provider: 'ollama', model: 'llama3'},
				},
			},
		};
		writeFileSync(
			join(projectDir, 'agents.config.json'),
			'\uFEFF' + JSON.stringify(projectAgents),
		);
		const profiles = loadAvailableProfiles(projectDir);
		t.truthy(profiles.bomProfile);
		t.is(profiles.bomProfile.provider, 'ollama');
	},
);

test.serial('/profile --clear clears active profile', async t => {
	const projectAgents = {
		nanocoder: {
			defaultProfile: 'fast',
			profiles: {
				fast: {provider: 'ollama', model: 'qwen2.5:7b'},
			},
		},
	};
	process.env.NANOCODER_CONFIG_DIR = globalDir;
	writeFileSync(
		join(globalDir, 'agents.config.json'),
		JSON.stringify(projectAgents),
	);

	setActiveProfile('fast', globalDir);
	t.is(getActiveProfileName(globalDir), 'fast');

	const messages: unknown[] = [];
	const context: Partial<CommandContext> = {
		args: ['--clear'],
		argText: '--clear',
		addToChatQueue: msg => messages.push(msg),
	};
	const res = await profileCommand.run(context as CommandContext);
	t.is(res, 'done');
	t.is(getActiveProfileName(globalDir), undefined);
	t.is(messages.length, 1);
});

test.serial(
	'/profile applies profile mode and reports model switch failure',
	async t => {
		const projectAgents = {
			nanocoder: {
				profiles: {
					architect: {mode: 'architect'},
					failingModel: {provider: 'broken', model: 'broken-model'},
				},
			},
		};
		process.env.NANOCODER_CONFIG_DIR = globalDir;
		writeFileSync(
			join(globalDir, 'agents.config.json'),
			JSON.stringify(projectAgents),
		);

		let switchedMode: string | undefined;
		const messages: unknown[] = [];
		const context: Partial<CommandContext> = {
			args: ['architect'],
			argText: 'architect',
			provider: 'default',
			model: 'default',
			addToChatQueue: msg => messages.push(msg),
			switchMode: mode => {
				switchedMode = mode;
			},
			switchModel: async () => false,
		};

		// 1. Switches mode
		const res1 = await profileCommand.run(context as CommandContext);
		t.is(res1, 'done');
		t.is(switchedMode, 'architect');

		// 2. Model switch returns false -> reports failure message
		messages.length = 0;
		context.args = ['failingModel'];
		context.argText = 'failingModel';
		const res2 = await profileCommand.run(context as CommandContext);
		t.is(res2, 'done');
		t.is(messages.length, 1);
	},
);
