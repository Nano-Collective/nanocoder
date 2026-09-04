import {execFile} from 'node:child_process';
import {access, mkdir, mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {promisify} from 'node:util';
import test from 'ava';
import {
	buildTrustSummary,
	fetchSkillIndex,
	formatTrustSummary,
	parseInstallTarget,
	runSkillsCli,
	stageSkillInstall,
} from './install.js';

console.log('\ninstall.spec.ts');

const execFileAsync = promisify(execFile);

/** Per-test scratch: the project and config dirs an install writes into. */
let dir: string;
/**
 * Source repositories, built once. Every test clones from one of these, so a
 * test costs one `git clone` rather than a whole repo build.
 */
let fixtures: string;

const savedConfigDir = process.env.NANOCODER_CONFIG_DIR;
const savedIndex = process.env.NANOCODER_SKILLS_INDEX;

/** Multi-bundle fixture repository; bundles are selected with `subdir`. */
let mono: string;
/** Fixture repository whose bundle lives at `skills/nested-skill/`. */
let nested: string;
/** Memoized fixture build, so the repos are created at most once. */
let fixtureBuild: Promise<void> | undefined;

const GIT_ENV = {
	GIT_AUTHOR_NAME: 'test',
	GIT_AUTHOR_EMAIL: 'test@example.com',
	GIT_COMMITTER_NAME: 'test',
	GIT_COMMITTER_EMAIL: 'test@example.com',
};

function manifest(name: string, extra = ''): string {
	return `name: ${name}\ndescription: A test skill for the installer.\n${extra}`;
}

function toolFile(name: string, approval: string, readOnly: boolean): string {
	return [
		'---',
		`name: ${name}`,
		'description: Prints a greeting.',
		`approval: ${approval}`,
		`read_only: ${readOnly}`,
		'parameters: {}',
		'---',
		'echo hello',
		'',
	].join('\n');
}

function agentFile(name: string): string {
	return `---\nname: ${name}\ndescription: A test agent.\n---\n\nYou are a test agent.\n`;
}

async function git(repo: string, args: string[]): Promise<string> {
	const {stdout} = await execFileAsync('git', args, {
		cwd: repo,
		env: {...process.env, ...GIT_ENV},
	});
	return stdout;
}

/**
 * Build one git repository holding every bundle fixture as a subdirectory,
 * plus a symlink entry written straight into the index. One repo keeps the
 * fixture cost at a handful of `git` spawns; each test then pays for exactly
 * one `git clone` and selects its bundle with `subdir`.
 *
 * The root deliberately has no `skill.yaml`, so cloning it without a subdir
 * is also the "which of these bundles did you mean?" case.
 */
async function makeFixtureRepo(): Promise<string> {
	const repo = join(fixtures, 'mono');
	const files: Record<string, string> = {
		// Happy path: one agent, one tool that asks before destructive writes,
		// and a version the collision test can tell apart.
		'bundle/skill.yaml': manifest(
			'demo',
			'version: 1.2.0\nauthor: someone\n',
		),
		'bundle/agents/demo-agent.md': agentFile('demo-agent'),
		'bundle/tools/greet.md': toolFile('greet', 'destructive', false),

		'broken/skill.yaml': manifest('broken'),
		'broken/tools/bad.md': 'no frontmatter here',

		'traversal/skill.yaml': manifest(
			'traversal',
			'include:\n  tools: ["../../../etc/*.md"]\n',
		),
		'traversal/agents/a.md': agentFile('a'),

		'trust/skill.yaml': manifest(
			'trusty',
			'tools_visibility: scoped\nsubscribe:\n  - kind: schedule.cron\n    target: agent:watcher\n    cron: "0 9 * * MON"\n',
		),
		'trust/agents/watcher.md': agentFile('watcher'),
		'trust/tools/silent.md': toolFile('silent', 'never', false),
		'trust/tools/careful.md': toolFile('careful', 'always', true),

		'symlinked/skill.yaml': manifest('sneaky'),
		'symlinked/agents/a.md': agentFile('a'),
	};

	await mkdir(repo, {recursive: true});
	for (const [relPath, content] of Object.entries(files)) {
		const full = join(repo, relPath);
		await mkdir(join(full, '..'), {recursive: true});
		await writeFile(full, content);
	}

	await git(repo, ['init', '-q', '-b', 'main']);
	await git(repo, ['add', '-A']);
	// A symlink (git mode 120000) staged straight into the index: `fs.symlink`
	// needs privileges on Windows, but a mode-120000 entry is portable and is
	// exactly what a hostile repo would ship.
	const linkTarget = join(fixtures, 'link-target');
	await writeFile(linkTarget, '../../../../secret.txt');
	const sha = (await git(repo, ['hash-object', '-w', linkTarget])).trim();
	await git(repo, [
		'update-index',
		'--add',
		'--cacheinfo',
		`120000,${sha},symlinked/tools/leak.md`,
	]);
	await git(repo, ['commit', '-q', '-m', 'fixtures', '--no-gpg-sign']);
	return repo;
}

/**
 * A second repo whose only bundle sits at `skills/<name>/`, covering the
 * auto-discovery path where no subdir is given.
 */
async function makeNestedRepo(): Promise<string> {
	const repo = join(fixtures, 'nested');
	await mkdir(join(repo, 'skills', 'nested-skill', 'agents'), {
		recursive: true,
	});
	await writeFile(
		join(repo, 'skills', 'nested-skill', 'skill.yaml'),
		manifest('nested-skill'),
	);
	await writeFile(
		join(repo, 'skills', 'nested-skill', 'agents', 'a.md'),
		agentFile('a'),
	);
	await git(repo, ['init', '-q', '-b', 'main']);
	await git(repo, ['add', '-A']);
	await git(repo, ['commit', '-q', '-m', 'initial', '--no-gpg-sign']);
	return repo;
}

/**
 * Build the fixture repos on first use rather than in a `before` hook: the
 * pure-parsing tests then run and reset AVA's inactivity timer before the
 * git work starts, which keeps a cold run inside the default timeout.
 */
function ensureFixtures(): Promise<void> {
	fixtureBuild ??= (async () => {
		fixtures = await mkdtemp(join(tmpdir(), 'skill-install-repos-'));
		mono = await makeFixtureRepo();
		nested = await makeNestedRepo();
	})();
	return fixtureBuild;
}

test.after.always(async () => {
	if (fixtures) await rm(fixtures, {recursive: true, force: true});
});

test.beforeEach(async () => {
	dir = await mkdtemp(join(tmpdir(), 'skill-install-test-'));
	process.env.NANOCODER_CONFIG_DIR = join(dir, 'config');
	// Nothing in this file may reach the network: every test passes either an
	// explicit local index or a local repo path.
	process.env.NANOCODER_SKILLS_INDEX = join(dir, 'missing-index.json');
});

test.afterEach.always(async () => {
	if (savedConfigDir === undefined) delete process.env.NANOCODER_CONFIG_DIR;
	else process.env.NANOCODER_CONFIG_DIR = savedConfigDir;
	if (savedIndex === undefined) delete process.env.NANOCODER_SKILLS_INDEX;
	else process.env.NANOCODER_SKILLS_INDEX = savedIndex;
	await rm(dir, {recursive: true, force: true});
});

async function pathExists(path: string): Promise<boolean> {
	try {
		await access(path);
		return true;
	} catch {
		return false;
	}
}

async function writeIndex(entries: unknown[]): Promise<string> {
	const indexPath = join(dir, 'skills.json');
	await writeFile(indexPath, JSON.stringify({skills: entries}));
	return indexPath;
}

const projectRoot = () => join(dir, 'project');

// --- target parsing --------------------------------------------------------

test.serial('parseInstallTarget - bare names go through the index', t => {
	t.is(parseInstallTarget('pr-reviewer'), null);
});

test.serial('parseInstallTarget - recognises repositories and paths', t => {
	t.deepEqual(parseInstallTarget('owner/repo'), {
		repo: 'https://github.com/owner/repo.git',
	});
	t.deepEqual(parseInstallTarget('https://example.com/x.git'), {
		repo: 'https://example.com/x.git',
	});
	t.deepEqual(parseInstallTarget('git@example.com:owner/repo.git'), {
		repo: 'git@example.com:owner/repo.git',
	});
	t.deepEqual(parseInstallTarget('./local-repo'), {repo: './local-repo'});
});

// --- index -----------------------------------------------------------------

test.serial(
	'fetchSkillIndex - reads a local index and drops malformed entries',
	async t => {
		const indexPath = await writeIndex([
			{name: 'good', repo: 'https://example.com/good.git', ref: 'main'},
			{name: 'no-repo'},
			'nonsense',
		]);

		const entries = await fetchSkillIndex(indexPath);
		t.is(entries.length, 1);
		t.is(entries[0].name, 'good');
		t.is(entries[0].ref, 'main');
	},
);

test.serial('fetchSkillIndex - tolerates a UTF-8 BOM', async t => {
	const indexPath = join(dir, 'bom.json');
	await writeFile(
		indexPath,
		'﻿' + JSON.stringify({skills: [{name: 'good', repo: 'r'}]}),
	);

	const entries = await fetchSkillIndex(indexPath);
	t.is(entries.length, 1);
});

test.serial('stageSkillInstall - reports a missing index entry', async t => {
	const result = await stageSkillInstall('pr-reviewer', {
		projectRoot: projectRoot(),
		indexUrl: await writeIndex([]),
	});
	t.false(result.ok);
	if (!result.ok) t.regex(result.error, /No skill named "pr-reviewer"/);
});

test.serial('stageSkillInstall - resolves a name through the index', async t => {
	await ensureFixtures();
	const result = await stageSkillInstall('demo', {
		projectRoot: projectRoot(),
		indexUrl: await writeIndex([
			{name: 'demo', repo: mono, subdir: 'bundle'},
		]),
	});
	t.true(result.ok);
	if (!result.ok) return;
	t.is(result.staged.trust.name, 'demo');
	await result.staged.cleanup();
});

test.serial(
	'stageSkillInstall - refuses when the manifest name differs from the index name',
	async t => {
		await ensureFixtures();
		// The index promises "pr-reviewer"; the repo declares "demo".
		const result = await stageSkillInstall('pr-reviewer', {
			projectRoot: projectRoot(),
			indexUrl: await writeIndex([
				{name: 'pr-reviewer', repo: mono, subdir: 'bundle'},
			]),
		});
		t.false(result.ok);
		if (!result.ok) {
			t.regex(result.error, /lists "pr-reviewer" but the bundle declares/);
		}
	},
);

// --- staging ---------------------------------------------------------------

test.serial(
	'stageSkillInstall - clones and validates without writing to the project',
	async t => {
		await ensureFixtures();
		const result = await stageSkillInstall(mono, {
			projectRoot: projectRoot(),
			subdir: 'bundle',
		});
		t.true(result.ok);
		if (!result.ok) return;

		const {staged} = result;
		t.is(staged.trust.name, 'demo');
		t.is(staged.trust.version, '1.2.0');
		t.is(staged.trust.author, 'someone');
		t.is(staged.dest, join(projectRoot(), '.nanocoder', 'skills', 'demo'));
		// Staging must not touch the project.
		t.false(await pathExists(staged.dest));
		// `.git` is stripped from the clone before anything walks or copies it.
		t.false(await pathExists(join(staged.bundlePath, '.git')));

		await staged.cleanup();
		t.false(await pathExists(staged.bundlePath));
	},
);

test.serial(
	'stageSkillInstall - finds a bundle nested under skills/',
	async t => {
		await ensureFixtures();
		const result = await stageSkillInstall(nested, {
			projectRoot: projectRoot(),
		});
		t.true(result.ok);
		if (!result.ok) return;
		t.is(result.staged.trust.name, 'nested-skill');
		await result.staged.cleanup();
	},
);

test.serial(
	'stageSkillInstall - rejects a bundle that fails the linter',
	async t => {
		await ensureFixtures();
		const result = await stageSkillInstall(mono, {
			projectRoot: projectRoot(),
			subdir: 'broken',
		});
		t.false(result.ok);
		if (!result.ok) t.regex(result.error, /failed validation/);
	},
);

test.serial(
	'stageSkillInstall - names every candidate when a repo holds several bundles',
	async t => {
		await ensureFixtures();
		// The fixture repo's root holds no manifest, only sibling bundles.
		const result = await stageSkillInstall(mono, {
			projectRoot: projectRoot(),
		});
		t.false(result.ok);
		if (!result.ok) {
			t.regex(result.error, /holds 5 skill bundles/);
			t.regex(result.error, /Pick one with --subdir/);
			t.regex(result.error, /bundle/);
		}
	},
);

test.serial(
	'stageSkillInstall - rejects a subdir with no manifest',
	async t => {
		await ensureFixtures();
		const result = await stageSkillInstall(mono, {
			projectRoot: projectRoot(),
			subdir: 'bundle/agents',
		});
		t.false(result.ok);
		if (!result.ok) {
			t.regex(result.error, /No skill\.yaml at subdir "bundle\/agents"/);
		}
	},
);

// --- adversarial bundles ---------------------------------------------------

test.serial(
	'stageSkillInstall - rejects a bundle containing a symlink',
	async t => {
		await ensureFixtures();
		const result = await stageSkillInstall(mono, {
			projectRoot: projectRoot(),
			subdir: 'symlinked',
		});
		// Refused either way: a checkout that materializes the symlink trips
		// the tree scan; on Windows git writes a plain file instead, which then
		// fails the tool parser. Both name the offending file.
		t.false(result.ok);
		if (!result.ok) {
			t.regex(
				result.error,
				process.platform === 'win32' ? /leak\.md/ : /contains a symlink/,
			);
		}
	},
);

test.serial(
	'stageSkillInstall - rejects a subdir that escapes the clone',
	async t => {
		await ensureFixtures();
		const result = await stageSkillInstall(mono, {
			projectRoot: projectRoot(),
			subdir: '../../../etc',
		});
		t.false(result.ok);
		if (!result.ok) t.regex(result.error, /escapes the cloned repository/);
	},
);

test.serial(
	'stageSkillInstall - rejects a manifest whose include globs traverse upward',
	async t => {
		await ensureFixtures();
		const result = await stageSkillInstall(mono, {
			projectRoot: projectRoot(),
			subdir: 'traversal',
		});
		t.false(result.ok);
		if (!result.ok) t.regex(result.error, /must not traverse upward/);
	},
);

// --- trust prompt ----------------------------------------------------------

test.serial(
	'trust summary - names every tool with its declared approval policy',
	async t => {
		await ensureFixtures();
		const result = await stageSkillInstall(mono, {
			projectRoot: projectRoot(),
			subdir: 'trust',
		});
		t.true(result.ok);
		if (!result.ok) return;

		const loaded = result.staged.report.skill;
		if (!loaded) {
			t.fail('expected the linter to return the loaded skill');
			return;
		}

		const trust = buildTrustSummary(loaded);
		t.is(trust.tools.find(x => x.name === 'silent')?.approval, 'never');
		t.is(trust.tools.find(x => x.name === 'careful')?.approval, 'always');
		t.is(trust.agent, 'watcher');
		t.is(trust.subscriptions.length, 1);

		const rendered = formatTrustSummary(trust, result.staged.dest, mono);
		// The prompt has to say what "never" means, not just print the word.
		t.regex(
			rendered,
			/silent · shell script · approval: never \(runs WITHOUT asking\)/,
		);
		t.regex(rendered, /schedule\.cron → agent:watcher · cron "0 9 \* \* MON"/);
		t.regex(rendered, /daemon fires these unattended/);

		await result.staged.cleanup();
	},
);

// --- CLI -------------------------------------------------------------------

test.serial(
	'skills add - installs after the trust prompt is accepted',
	async t => {
		await ensureFixtures();
		let shown = '';
		const result = await runSkillsCli({
			projectRoot: projectRoot(),
			args: [mono, '--subdir', 'bundle'],
			confirm: prompt => {
				shown = prompt;
				return Promise.resolve(true);
			},
		});

		t.is(result.exitCode, 0);
		t.regex(result.output, /Installed "demo"/);
		t.regex(shown, /approval: destructive/);

		const landed = join(
			projectRoot(),
			'.nanocoder',
			'skills',
			'demo',
			'skill.yaml',
		);
		t.true((await readFile(landed, 'utf8')).includes('name: demo'));
	},
);

test.serial('skills add - declining writes nothing', async t => {
	await ensureFixtures();
	const result = await runSkillsCli({
		projectRoot: projectRoot(),
		args: [mono, '--subdir', 'bundle'],
		confirm: () => Promise.resolve(false),
	});

	t.is(result.exitCode, 0);
	t.regex(result.output, /Nothing was written/);
	t.false(await pathExists(join(projectRoot(), '.nanocoder', 'skills', 'demo')));
});

test.serial('skills add --yes - skips the prompt', async t => {
	await ensureFixtures();
	let asked = false;
	const result = await runSkillsCli({
		projectRoot: projectRoot(),
		args: [mono, '--subdir', 'bundle', '--yes'],
		confirm: () => {
			asked = true;
			return Promise.resolve(false);
		},
	});

	t.false(asked);
	t.is(result.exitCode, 0);
	// An unattended install still reports what it accepted.
	t.regex(result.output, /approval: destructive/);
	t.true(await pathExists(join(projectRoot(), '.nanocoder', 'skills', 'demo')));
});

test.serial('skills add - refuses to overwrite without --force', async t => {
	await ensureFixtures();
	const dest = join(projectRoot(), '.nanocoder', 'skills', 'demo');
	await mkdir(dest, {recursive: true});
	await writeFile(join(dest, 'skill.yaml'), manifest('demo', 'version: 1.0.0\n'));

	const blocked = await runSkillsCli({
		projectRoot: projectRoot(),
		args: [mono, '--subdir', 'bundle', '--yes'],
	});
	t.is(blocked.exitCode, 1);
	t.regex(blocked.output, /already exists.*--force/s);
	t.true((await readFile(join(dest, 'skill.yaml'), 'utf8')).includes('1.0.0'));

	const forced = await runSkillsCli({
		projectRoot: projectRoot(),
		args: [mono, '--subdir', 'bundle', '--yes', '--force'],
	});
	t.is(forced.exitCode, 0);
	t.true((await readFile(join(dest, 'skill.yaml'), 'utf8')).includes('1.2.0'));
});

test.serial('skills add --global - installs into the config dir', async t => {
	await ensureFixtures();
	const result = await runSkillsCli({
		projectRoot: projectRoot(),
		args: [mono, '--subdir', 'bundle', '--global', '--yes'],
	});

	t.is(result.exitCode, 0);
	t.true(await pathExists(join(dir, 'config', 'skills', 'demo', 'skill.yaml')));
	t.false(await pathExists(join(projectRoot(), '.nanocoder', 'skills', 'demo')));
});

test.serial(
	'skills add - flag values are not mistaken for the target',
	async t => {
		await ensureFixtures();
		const result = await runSkillsCli({
			projectRoot: projectRoot(),
			args: [
				'--ref',
				'main',
				'--subdir',
				'skills/nested-skill',
				'--yes',
				nested,
			],
		});

		t.is(result.exitCode, 0);
		t.regex(result.output, /Installed "nested-skill"/);
	},
);

test.serial('skills add - usage when no target is given', async t => {
	const result = await runSkillsCli({projectRoot: projectRoot(), args: []});
	t.is(result.exitCode, 1);
	t.regex(result.output, /Usage: nanocoder skills add/);
});
