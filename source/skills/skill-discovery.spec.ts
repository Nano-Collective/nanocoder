import {mkdirSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'ava';
import {SkillDiscovery} from './skill-discovery';

const SKILL_FILE = 'SKILL.md';

let testDir: string;

test.before(() => {
	testDir = join(tmpdir(), `nanocoder-skill-discovery-${Date.now()}`);
	mkdirSync(testDir, {recursive: true});
});

test.after.always(() => {
	if (testDir) {
		rmSync(testDir, {recursive: true, force: true});
	}
});

function writeSkill(dir: string, name: string, description: string): void {
	const skillDir = join(testDir, dir);
	mkdirSync(skillDir, {recursive: true});
	const content = `---
name: ${name}
description: ${description}
category: test
---
# ${name}

Body content.
`;
	writeFileSync(join(skillDir, SKILL_FILE), content, 'utf-8');
}

// ============================================================================
// SkillDiscovery - getSources
// ============================================================================

test('SkillDiscovery getSources returns default sources sorted by priority', t => {
	const discovery = new SkillDiscovery();
	const sources = discovery.getSources();
	t.true(sources.length >= 2);
	const personal = sources.find(s => s.type === 'personal');
	const project = sources.find(s => s.type === 'project');
	t.truthy(personal);
	t.truthy(project);
	t.true((personal?.priority ?? 0) < (project?.priority ?? 0));
});

// ============================================================================
// SkillDiscovery - discoverAll with custom source
// ============================================================================

test('SkillDiscovery discoverAll finds skills in added source', async t => {
	const skillsRoot = join(testDir, 'custom-source');
	mkdirSync(skillsRoot, {recursive: true});
	writeSkill('custom-source/skill-one', 'Skill One', 'First test skill');
	writeSkill('custom-source/skill-two', 'Skill Two', 'Second test skill');

	const discovery = new SkillDiscovery();
	discovery.addSource({
		type: 'plugin',
		location: skillsRoot,
		priority: 0,
		enabled: true,
	});

	const metadata = await discovery.discoverAll();

	const fromCustom = metadata.filter(m => m.id?.startsWith('plugin:'));
	t.is(fromCustom.length, 2);
	const names = fromCustom.map(m => m.name).sort();
	t.deepEqual(names, ['Skill One', 'Skill Two']);
});

test('SkillDiscovery discoverAll returns empty for missing SKILL.md', async t => {
	const emptyDir = join(testDir, 'no-skill-dir');
	mkdirSync(emptyDir, {recursive: true});
	// No SKILL.md

	const discovery = new SkillDiscovery();
	discovery.addSource({
		type: 'plugin',
		location: testDir,
		priority: 0,
		enabled: true,
	});

	const metadata = await discovery.discoverAll();
	const fromTest = metadata.filter(m => m.id?.startsWith('plugin:'));
	t.is(fromTest.length, 0);
});

test('SkillDiscovery getPathForSkill returns path info after discoverAll', async t => {
	const root = join(testDir, 'path-check');
	mkdirSync(root, {recursive: true});
	writeSkill('path-check/my-skill', 'My Skill', 'For path check');

	const discovery = new SkillDiscovery();
	discovery.addSource({
		type: 'remote',
		location: root,
		priority: 0,
		enabled: true,
	});
	await discovery.discoverAll();

	const pathInfo = discovery.getPathForSkill('remote:my-skill');
	t.truthy(pathInfo);
	t.is(pathInfo!.dirName, 'my-skill');
	t.is(pathInfo!.source.type, 'remote');
	t.true(pathInfo!.path.endsWith('my-skill'));
});

test('SkillDiscovery getPathForSkill returns undefined for unknown id', async t => {
	const discovery = new SkillDiscovery();
	await discovery.discoverAll();
	t.is(discovery.getPathForSkill('unknown:nope'), undefined);
});

test('SkillDiscovery getCachedMetadata returns metadata after discoverAll', async t => {
	const root = join(testDir, 'cache-check');
	mkdirSync(root, {recursive: true});
	writeSkill('cache-check/cached', 'Cached Skill', 'For cache check');

	const discovery = new SkillDiscovery();
	discovery.addSource({
		type: 'plugin',
		location: root,
		priority: 0,
		enabled: true,
	});
	await discovery.discoverAll();

	const meta = discovery.getCachedMetadata('plugin:cached');
	t.truthy(meta);
	t.is(meta!.name, 'Cached Skill');
	t.is(meta!.description, 'For cache check');
});

test('SkillDiscovery discoverAll skips disabled sources', async t => {
	const root = join(testDir, 'disabled-source');
	mkdirSync(root, {recursive: true});
	writeSkill('disabled-source/hidden', 'Hidden', 'Should not appear');

	const discovery = new SkillDiscovery();
	discovery.addSource({
		type: 'plugin',
		location: root,
		priority: 0,
		enabled: false,
	});

	const metadata = await discovery.discoverAll();
	const fromPlugin = metadata.filter(m => m.id?.startsWith('plugin:'));
	t.is(fromPlugin.length, 0);
});
