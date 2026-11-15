import {mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync} from 'fs';
import {tmpdir} from 'os';
import {join} from 'path';
import test from 'ava';
import {
	createSessionContext,
	runInSessionContext,
} from '@/services/session-context';
import {
	clearAppConfig,
	getAppConfig,
	getClosestConfigFile,
	loadDefaultMode,
} from './index';
import {loadAllMCPConfigs, loadAllProviderConfigs} from './mcp-config-loader';

console.log('\nsession-root-config.spec.ts');

// One process, two project folders: the launch directory and another one an
// ACP session names. Global config is isolated in an empty directory.
const base = mkdtempSync(join(tmpdir(), 'nanocoder-session-root-'));
const launchDir = join(base, 'launch');
const projectDir = join(base, 'project');
const globalDir = join(base, 'global');
const originalCwd = process.cwd();
const originalConfigDir = process.env.NANOCODER_CONFIG_DIR;

function writeProject(
	dir: string,
	name: string,
	extra: Record<string, unknown> = {},
): void {
	mkdirSync(dir, {recursive: true});
	writeFileSync(
		join(dir, 'agents.config.json'),
		JSON.stringify({
			nanocoder: {
				providers: [{name: `${name}-provider`, models: ['m']}],
				alwaysAllow: [`${name}_tool`],
				defaultMode: name === 'launch' ? 'plan' : 'yolo',
				...extra,
			},
		}),
	);
	writeFileSync(
		join(dir, '.mcp.json'),
		JSON.stringify({
			mcpServers: {[`${name}-server`]: {transport: 'stdio', command: 'true'}},
		}),
	);
}

test.before(() => {
	mkdirSync(globalDir, {recursive: true});
	writeProject(launchDir, 'launch');
	writeProject(projectDir, 'project');
	process.env.NANOCODER_CONFIG_DIR = globalDir;
	process.chdir(launchDir);
	clearAppConfig();
});

test.after.always(() => {
	process.chdir(originalCwd);
	if (originalConfigDir === undefined) {
		delete process.env.NANOCODER_CONFIG_DIR;
	} else {
		process.env.NANOCODER_CONFIG_DIR = originalConfigDir;
	}
	clearAppConfig();
	rmSync(base, {recursive: true, force: true});
});

const inProject = <T>(run: () => T): T =>
	runInSessionContext(createSessionContext(projectDir), run);

test.serial('a session reads the project config of its own folder', t => {
	const config = inProject(() => getAppConfig());
	t.deepEqual(config.alwaysAllow, ['project_tool']);
	t.deepEqual(
		config.providers.map(p => p.name),
		['project-provider'],
	);
	t.deepEqual(
		config.mcpServers?.map(s => s.name),
		['project-server'],
	);
	t.deepEqual(
		inProject(() => loadAllProviderConfigs()).map(p => p.name),
		['project-provider'],
	);
	t.deepEqual(
		inProject(() => loadAllMCPConfigs()).map(s => s.server.name),
		['project-server'],
	);
	t.is(
		inProject(() => loadDefaultMode()),
		'yolo',
	);
});

test.serial('outside a session the launch directory config is unchanged', t => {
	inProject(() => getAppConfig());
	const config = getAppConfig();
	t.deepEqual(config.alwaysAllow, ['launch_tool']);
	t.deepEqual(
		config.providers.map(p => p.name),
		['launch-provider'],
	);
	t.is(loadDefaultMode(), 'plan');
});

test.serial(
	'a session in the launch folder shares its config, however the folder is spelled',
	t => {
		const link = join(base, 'launch-link');
		symlinkSync(launchDir, link);
		const launchConfig = getAppConfig();
		t.is(
			runInSessionContext(createSessionContext(launchDir), () =>
				getAppConfig(),
			),
			launchConfig,
		);
		t.is(
			runInSessionContext(createSessionContext(link), () => getAppConfig()),
			launchConfig,
		);
	},
);

test.serial('concurrent sessions in different folders keep their own', async t => {
	const read = (dir: string) =>
		runInSessionContext(createSessionContext(dir), async () => {
			await new Promise(resolve => setTimeout(resolve, 10));
			return getAppConfig().alwaysAllow;
		});
	t.deepEqual(await Promise.all([read(projectDir), read(launchDir)]), [
		['project_tool'],
		['launch_tool'],
	]);
});

test.serial('getClosestConfigFile looks in the session folder first', t => {
	// NANOCODER_CONFIG_DIR skips the project lookup altogether.
	delete process.env.NANOCODER_CONFIG_DIR;
	try {
		t.is(
			inProject(() => getClosestConfigFile('agents.config.json')),
			join(projectDir, 'agents.config.json'),
		);
	} finally {
		process.env.NANOCODER_CONFIG_DIR = globalDir;
	}
});

test.serial('clearing the config drops session folders too', t => {
	t.deepEqual(inProject(() => getAppConfig().alwaysAllow), ['project_tool']);
	writeProject(projectDir, 'project', {alwaysAllow: ['edited_tool']});
	clearAppConfig();
	t.deepEqual(inProject(() => getAppConfig().alwaysAllow), ['edited_tool']);
});
