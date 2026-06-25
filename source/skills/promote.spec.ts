import {access, mkdir, mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'ava';
import {applyPromotion, planPromotion} from './promote.js';
import type {Skill} from '@/types/skills';

console.log('\npromote.spec.ts');

function bundleSkill(name: string, rootPath: string, priority: Skill['source']['priority']): Skill {
	return {
		name,
		description: 'test bundle',
		toolsVisibility: 'scoped',
		tools: [{filePath: join(rootPath, 'tools', 't.md')} as never],
		source: {priority, shape: 'bundle', rootPath},
	};
}

function singleFileSkill(name: string, rootPath: string, priority: Skill['source']['priority']): Skill {
	return {
		name,
		description: 'test command',
		toolsVisibility: 'global',
		commands: [{filePath: rootPath} as never],
		source: {priority, shape: 'single-file', rootPath},
	};
}

let dir: string;
const savedConfigDir = process.env.NANOCODER_CONFIG_DIR;

test.beforeEach(async () => {
	dir = await mkdtemp(join(tmpdir(), 'promote-test-'));
	process.env.NANOCODER_CONFIG_DIR = join(dir, 'config');
});

test.afterEach.always(async () => {
	if (savedConfigDir === undefined) delete process.env.NANOCODER_CONFIG_DIR;
	else process.env.NANOCODER_CONFIG_DIR = savedConfigDir;
	await rm(dir, {recursive: true, force: true});
});

test.serial('planPromotion - refuses to promote a personal skill', t => {
	const skill = bundleSkill('foo', join(dir, 'foo'), 'personal');
	const res = planPromotion(skill, 'promote', dir);
	t.true('error' in res);
});

test.serial('planPromotion - refuses to promote a built-in skill', t => {
	const skill = bundleSkill('foo', join(dir, 'foo'), 'built-in');
	const res = planPromotion(skill, 'promote', dir);
	t.true('error' in res);
});

test.serial('planPromotion - refuses to demote a project skill', t => {
	const skill = bundleSkill('foo', join(dir, 'foo'), 'project');
	const res = planPromotion(skill, 'demote', dir);
	t.true('error' in res);
});

test.serial('planPromotion - allows demoting a built-in skill into the project', t => {
	const skill = bundleSkill('foo', join(dir, 'foo'), 'built-in');
	const res = planPromotion(skill, 'demote', dir);
	t.true('plan' in res);
	if ('plan' in res) {
		t.is(res.plan.toLevel, 'project');
		t.is(res.plan.dest, join(dir, '.nanocoder', 'skills', 'foo'));
	}
});

test.serial('promote - copies a project bundle to the global config dir', async t => {
	const src = join(dir, 'project', '.nanocoder', 'skills', 'foo');
	await mkdir(src, {recursive: true});
	await writeFile(join(src, 'skill.yaml'), 'name: foo\ndescription: x\n');

	const skill = bundleSkill('foo', src, 'project');
	const planned = planPromotion(skill, 'promote', join(dir, 'project'));
	t.true('plan' in planned);
	if (!('plan' in planned)) return;

	const result = await applyPromotion(planned.plan, false);
	t.true(result.ok);

	const dest = join(dir, 'config', 'skills', 'foo', 'skill.yaml');
	const body = await readFile(dest, 'utf8');
	t.true(body.includes('name: foo'));
});

test.serial('promote - refuses to overwrite an existing destination without force', async t => {
	const src = join(dir, 'project', '.nanocoder', 'skills', 'foo');
	await mkdir(src, {recursive: true});
	await writeFile(join(src, 'skill.yaml'), 'name: foo\ndescription: new\n');

	const dest = join(dir, 'config', 'skills', 'foo');
	await mkdir(dest, {recursive: true});
	await writeFile(join(dest, 'skill.yaml'), 'name: foo\ndescription: old\n');

	const skill = bundleSkill('foo', src, 'project');
	const planned = planPromotion(skill, 'promote', join(dir, 'project'));
	if (!('plan' in planned)) {
		t.fail('expected a plan');
		return;
	}

	const blocked = await applyPromotion(planned.plan, false);
	t.true(blocked.destExists);
	t.false(blocked.ok);
	// Original untouched.
	t.true((await readFile(join(dest, 'skill.yaml'), 'utf8')).includes('old'));

	// With force it overwrites.
	const forced = await applyPromotion(planned.plan, true);
	t.true(forced.ok);
	t.true((await readFile(join(dest, 'skill.yaml'), 'utf8')).includes('new'));
});

test.serial('demote - copies a single-file command into the project flat dir', async t => {
	const src = join(dir, 'config', 'commands', 'greet.md');
	await mkdir(join(dir, 'config', 'commands'), {recursive: true});
	await writeFile(src, '---\ndescription: hi\n---\nbody');

	const skill = singleFileSkill('greet', src, 'personal');
	const planned = planPromotion(skill, 'demote', join(dir, 'project'));
	t.true('plan' in planned);
	if (!('plan' in planned)) return;

	const result = await applyPromotion(planned.plan, false);
	t.true(result.ok);

	const dest = join(dir, 'project', '.nanocoder', 'commands', 'greet.md');
	await t.notThrowsAsync(access(dest));
});
