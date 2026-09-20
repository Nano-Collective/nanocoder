import {mkdir, mkdtemp, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'ava';
import {BundleLoader} from './bundle-loader';

console.log(`\nbundle-loader.spec.ts`);

/**
 * Set up an isolated project root + personal config dir under tmpdir.
 * NANOCODER_CONFIG_DIR is set so the loader's personal-layer lookup hits the
 * temp dir rather than the user's real config.
 */
async function withTempEnv(
	fn: (paths: {projectRoot: string; personalRoot: string}) => Promise<void>,
): Promise<void> {
	const root = await mkdtemp(join(tmpdir(), 'bundle-loader-'));
	const projectRoot = join(root, 'project');
	const personalRoot = join(root, 'personal');
	await mkdir(join(projectRoot, '.nanocoder', 'skills'), {recursive: true});
	await mkdir(join(personalRoot, 'skills'), {recursive: true});
	const prev = process.env.NANOCODER_CONFIG_DIR;
	process.env.NANOCODER_CONFIG_DIR = personalRoot;
	try {
		await fn({projectRoot, personalRoot});
	} finally {
		if (prev === undefined) delete process.env.NANOCODER_CONFIG_DIR;
		else process.env.NANOCODER_CONFIG_DIR = prev;
		await rm(root, {recursive: true, force: true});
	}
}

async function makeBundle(
	root: string,
	name: string,
	files: Record<string, string>,
): Promise<string> {
	const bundleDir = join(root, name);
	await mkdir(bundleDir, {recursive: true});
	for (const [rel, content] of Object.entries(files)) {
		const filePath = join(bundleDir, rel);
		await mkdir(join(filePath, '..'), {recursive: true});
		await writeFile(filePath, content);
	}
	return bundleDir;
}

test.serial(
	'loads a minimal bundle with subagent + tool, defaults visibility to scoped',
	async t => {
		await withTempEnv(async ({projectRoot}) => {
			const bundleRoot = join(projectRoot, '.nanocoder', 'skills');
			await makeBundle(bundleRoot, 'k8s', {
				'skill.yaml': `
name: k8s
description: Kubernetes helpers.
`,
				'agents/k8s-agent.md': `---
name: k8s-agent
description: Watches the cluster.
---
You watch the cluster.
`,
				'tools/k8s_pods.md': `---
name: k8s_pods
description: List pods.
approval: never
read_only: true
parameters:
  ns:
    type: string
---
echo {{ ns }}
`,
			});

			const loader = new BundleLoader(projectRoot);
			const {skills, errors} = await loader.load();
			t.deepEqual(errors, []);
			t.is(skills.length, 1);
			const skill = skills[0];
			if (!skill) return t.fail();
			t.is(skill.name, 'k8s');
			t.is(skill.source.shape, 'bundle');
			t.is(skill.source.priority, 'project');
			t.is(skill.toolsVisibility, 'scoped');
			t.is(skill.subagent?.subagent.name, 'k8s-agent');
			t.is(skill.tools?.length, 1);
			t.is(skill.tools?.[0]?.tool.name, 'k8s_pods');
		});
	},
);

test.serial(
	'bundle without skill.yaml is silently skipped',
	async t => {
		await withTempEnv(async ({projectRoot}) => {
			const bundleRoot = join(projectRoot, '.nanocoder', 'skills');
			await makeBundle(bundleRoot, 'broken-bundle', {
				'commands/foo.md': `---
description: orphan command
---
hi
`,
			});

			const loader = new BundleLoader(projectRoot);
			const {skills, errors} = await loader.load();
			t.deepEqual(skills, []);
			t.deepEqual(errors, []);
		});
	},
);

test.serial(
	'malformed skill.yaml produces an error and skips the bundle',
	async t => {
		await withTempEnv(async ({projectRoot}) => {
			const bundleRoot = join(projectRoot, '.nanocoder', 'skills');
			await makeBundle(bundleRoot, 'busted', {
				'skill.yaml': 'name: BUSTED\ndescription: bad name',
			});

			const loader = new BundleLoader(projectRoot);
			const {skills, errors} = await loader.load();
			t.is(skills.length, 0);
			t.is(errors.length, 1);
			t.regex(errors[0]?.message ?? '', /name/i);
		});
	},
);

test.serial(
	'project bundle shadows personal bundle by name',
	async t => {
		await withTempEnv(async ({projectRoot, personalRoot}) => {
			await makeBundle(join(personalRoot, 'skills'), 'shared', {
				'skill.yaml': 'name: shared\ndescription: from personal',
			});
			await makeBundle(join(projectRoot, '.nanocoder', 'skills'), 'shared', {
				'skill.yaml': 'name: shared\ndescription: from project',
			});

			const loader = new BundleLoader(projectRoot);
			const {skills, errors} = await loader.load();
			t.deepEqual(errors, []);
			t.is(skills.length, 1);
			t.is(skills[0]?.description, 'from project');
			t.is(skills[0]?.source.priority, 'project');
		});
	},
);

test.serial(
	'manifest subscription with unresolved target is rejected',
	async t => {
		await withTempEnv(async ({projectRoot}) => {
			const bundleRoot = join(projectRoot, '.nanocoder', 'skills');
			await makeBundle(bundleRoot, 'orphan-sub', {
				'skill.yaml': `
name: orphan-sub
description: dangling subscription.
subscribe:
  - kind: file.changed
    target: agent:nope
    paths: ["src/**"]
`,
			});

			const loader = new BundleLoader(projectRoot);
			const {skills, errors} = await loader.load();
			t.is(skills.length, 1);
			t.is(skills[0]?.subscribe ?? undefined, undefined);
			t.is(errors.length, 1);
			t.regex(errors[0]?.message ?? '', /does not resolve/);
		});
	},
);

test.serial(
	'frontmatter subscription target is resolved to the owning member',
	async t => {
		await withTempEnv(async ({projectRoot}) => {
			const bundleRoot = join(projectRoot, '.nanocoder', 'skills');
			await makeBundle(bundleRoot, 'docs', {
				'skill.yaml': 'name: docs\ndescription: doc watcher.',
				'agents/docs-agent.md': `---
name: docs-agent
description: watches docs
subscribe:
  - kind: file.changed
    paths: ["docs/**"]
---
You watch docs.
`,
			});

			const loader = new BundleLoader(projectRoot);
			const {skills, errors} = await loader.load();
			t.deepEqual(errors, []);
			t.is(skills.length, 1);
			t.is(skills[0]?.subscribe?.length, 1);
			t.is(skills[0]?.subscribe?.[0]?.target, 'agent:docs-agent');
		});
	},
);

test.serial(
	'frontmatter with explicit target on a bundle member is an error',
	async t => {
		await withTempEnv(async ({projectRoot}) => {
			const bundleRoot = join(projectRoot, '.nanocoder', 'skills');
			await makeBundle(bundleRoot, 'bad-target', {
				'skill.yaml': 'name: bad-target\ndescription: x.',
				'agents/foo.md': `---
name: foo
description: x.
subscribe:
  - kind: file.changed
    target: agent:something-else
    paths: ["x/**"]
---
body
`,
			});

			const loader = new BundleLoader(projectRoot);
			const {skills, errors} = await loader.load();
			t.is(skills.length, 1);
			t.true(
				errors.some(e =>
					/target must be omitted in member frontmatter/.test(e.message),
				),
			);
		});
	},
);

test.serial(
	'duplicate (kind, target) across manifest and frontmatter is an error',
	async t => {
		await withTempEnv(async ({projectRoot}) => {
			const bundleRoot = join(projectRoot, '.nanocoder', 'skills');
			await makeBundle(bundleRoot, 'dup', {
				'skill.yaml': `
name: dup
description: x.
subscribe:
  - kind: file.changed
    target: agent:foo
    paths: ["a/**"]
`,
				'agents/foo.md': `---
name: foo
description: x.
subscribe:
  - kind: file.changed
    paths: ["b/**"]
---
body
`,
			});

			const loader = new BundleLoader(projectRoot);
			const {skills, errors} = await loader.load();
			t.is(skills.length, 1);
			t.true(errors.some(e => /Duplicate subscription/.test(e.message)));
		});
	},
);

test.serial(
	'tools_visibility=global overrides the default scoped',
	async t => {
		await withTempEnv(async ({projectRoot}) => {
			const bundleRoot = join(projectRoot, '.nanocoder', 'skills');
			await makeBundle(bundleRoot, 'open', {
				'skill.yaml': `
name: open
description: tools opened up.
tools_visibility:
  default: global
`,
			});

			const loader = new BundleLoader(projectRoot);
			const {skills} = await loader.load();
			t.is(skills[0]?.toolsVisibility, 'global');
		});
	},
);

test.serial(
	'multiple commands in a bundle: all register, auto-namespaced under bundle name',
	async t => {
		await withTempEnv(async ({projectRoot}) => {
			const bundleRoot = join(projectRoot, '.nanocoder', 'skills');
			await makeBundle(bundleRoot, 'multi', {
				'skill.yaml': 'name: multi\ndescription: many verbs.',
				'commands/status.md': `---
description: show status
---
body
`,
				'commands/logs.md': `---
description: show logs
---
body
`,
			});

			const loader = new BundleLoader(projectRoot);
			const {skills, errors} = await loader.load();
			t.deepEqual(errors, []);
			t.is(skills.length, 1);
			const skill = skills[0];
			if (!skill) return t.fail();
			t.is(skill.commands?.length, 2);
			const fullNames = skill.commands
				?.map(c => c.command.fullName)
				.sort();
			t.deepEqual(fullNames, ['multi:logs', 'multi:status']);
			for (const c of skill.commands ?? []) {
				t.is(c.command.namespace, 'multi');
			}
		});
	},
);

test.serial(
	'commands/<bundleName>.md keeps the bare name (no namespace)',
	async t => {
		await withTempEnv(async ({projectRoot}) => {
			const bundleRoot = join(projectRoot, '.nanocoder', 'skills');
			await makeBundle(bundleRoot, 'k8s', {
				'skill.yaml': 'name: k8s\ndescription: single command.',
				'commands/k8s.md': `---
description: the bundle command
---
body
`,
			});

			const loader = new BundleLoader(projectRoot);
			const {skills, errors} = await loader.load();
			t.deepEqual(errors, []);
			t.is(skills[0]?.commands?.length, 1);
			t.is(skills[0]?.commands?.[0]?.command.fullName, 'k8s');
			t.is(skills[0]?.commands?.[0]?.command.namespace, undefined);
		});
	},
);
