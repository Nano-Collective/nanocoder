import {mkdir, mkdtemp, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'ava';
import {checkSkillBundle, formatSkillCheckReport} from './check';

console.log(`\ncheck.spec.ts`);

async function withTempProject(
	fn: (projectRoot: string) => Promise<void>,
): Promise<void> {
	const root = await mkdtemp(join(tmpdir(), 'skill-check-'));
	const projectRoot = join(root, 'project');
	await mkdir(join(projectRoot, '.nanocoder', 'skills'), {recursive: true});
	try {
		await fn(projectRoot);
	} finally {
		await rm(root, {recursive: true, force: true});
	}
}

async function makeBundle(
	projectRoot: string,
	name: string,
	files: Record<string, string>,
): Promise<void> {
	const bundleDir = join(projectRoot, '.nanocoder', 'skills', name);
	await mkdir(bundleDir, {recursive: true});
	for (const [rel, content] of Object.entries(files)) {
		const filePath = join(bundleDir, rel);
		await mkdir(join(filePath, '..'), {recursive: true});
		await writeFile(filePath, content);
	}
}

test.serial('passes a valid bundle with agent + tool', async t => {
	await withTempProject(async projectRoot => {
		await makeBundle(projectRoot, 'k8s', {
			'skill.yaml': 'name: k8s\ndescription: Kubernetes helpers.\n',
			'agents/k8s-agent.md': `---
name: k8s-agent
description: Watches the cluster.
---
You watch the cluster.
`,
			'tools/list_pods.md': `---
name: list_pods
description: List pods.
approval: never
---
kubectl get pods
`,
		});

		const report = await checkSkillBundle(projectRoot, 'k8s');
		t.true(report.ok);
		t.true(report.found);
		t.is(report.issues.filter(i => i.severity === 'error').length, 0);
		t.true(formatSkillCheckReport(report).startsWith('PASS'));
	});
});

test.serial('fails when the bundle does not exist', async t => {
	await withTempProject(async projectRoot => {
		const report = await checkSkillBundle(projectRoot, 'ghost');
		t.false(report.found);
		t.false(report.ok);
		t.true(formatSkillCheckReport(report).startsWith('FAIL'));
	});
});

test.serial('flags a kebab-case tool name as an error', async t => {
	await withTempProject(async projectRoot => {
		await makeBundle(projectRoot, 'bad', {
			'skill.yaml': 'name: bad\ndescription: Has a malformed tool.\n',
			'tools/list-pods.md': `---
name: list-pods
description: List pods.
approval: never
---
kubectl get pods
`,
		});

		const report = await checkSkillBundle(projectRoot, 'bad');
		t.false(report.ok);
		t.true(report.issues.some(i => i.severity === 'error'));
	});
});

test.serial('flags a subscribe target that does not resolve', async t => {
	await withTempProject(async projectRoot => {
		await makeBundle(projectRoot, 'subs', {
			'skill.yaml': `name: subs
description: Bad subscription target.
subscribe:
  - kind: file.changed
    target: agent:missing-agent
    paths: ["src/**/*.ts"]
`,
		});

		const report = await checkSkillBundle(projectRoot, 'subs');
		t.false(report.ok);
		t.true(
			report.issues.some(
				i => i.severity === 'error' && /does not resolve/.test(i.message),
			),
		);
	});
});

test.serial('warns when scoped tools have no agent to use them', async t => {
	await withTempProject(async projectRoot => {
		await makeBundle(projectRoot, 'orphan', {
			'skill.yaml': 'name: orphan\ndescription: Scoped tool, no agent.\n',
			'tools/list_pods.md': `---
name: list_pods
description: List pods.
approval: never
---
kubectl get pods
`,
		});

		const report = await checkSkillBundle(projectRoot, 'orphan');
		// No hard errors, so it still "passes", but warns about reachability.
		t.true(report.ok);
		t.true(
			report.issues.some(
				i => i.severity === 'warning' && /scoped/.test(i.message),
			),
		);
	});
});

test.serial(
	'fails when a command body references an undeclared placeholder',
	async t => {
		await withTempProject(async projectRoot => {
			await makeBundle(projectRoot, 'cmdbad', {
				'skill.yaml': 'name: cmdbad\ndescription: Command with a stray placeholder.\n',
				'commands/cmdbad.md': `---
description: Review a PR.
---
Review pull request #{{ pr_number }}.
`,
			});

			const report = await checkSkillBundle(projectRoot, 'cmdbad');
			t.false(report.ok);
			t.true(
				report.issues.some(
					i =>
						i.severity === 'error' &&
						/not a declared parameter or a built-in/.test(i.message),
				),
			);
		});
	},
);

test.serial(
	'names the mistake when a command uses the tool parameter format',
	async t => {
		await withTempProject(async projectRoot => {
			await makeBundle(projectRoot, 'mapparam', {
				'skill.yaml':
					'name: mapparam\ndescription: Command using the tool param mapping.\n',
				'commands/mapparam.md': `---
description: Review a PR.
parameters:
  pr_number:
    type: string
    required: true
---
Reviewing #{{ pr_number }}.
`,
			});

			const report = await checkSkillBundle(projectRoot, 'mapparam');
			t.false(report.ok);
			t.true(
				report.issues.some(
					i =>
						i.severity === 'error' &&
						/not a list of names/.test(i.message) &&
						/NOT the custom-tool format/.test(i.message),
				),
			);
		});
	},
);

test.serial(
	'passes a tool body that uses inverted sections with declared params',
	async t => {
		await withTempProject(async projectRoot => {
			await makeBundle(projectRoot, 'inv', {
				'skill.yaml': 'name: inv\ndescription: Tool with an inverted section.\n',
				'agents/inv-agent.md': `---
name: inv-agent
description: Uses the tool.
---
You use the tool.
`,
				'tools/show_pr.md': `---
name: show_pr
description: Show a PR.
approval: never
parameters:
  pr_number:
    type: string
    required: true
  json:
    type: boolean
    required: false
    default: false
---
{{# json }}gh pr view {{ pr_number }} --json title{{/ json }}
{{^ json }}gh pr view {{ pr_number }}{{/ json }}
`,
			});

			const report = await checkSkillBundle(projectRoot, 'inv');
			t.true(report.ok, formatSkillCheckReport(report));
		});
	},
);

test.serial('warns when the description is still the scaffold default', async t => {
	await withTempProject(async projectRoot => {
		await makeBundle(projectRoot, 'fresh', {
			'skill.yaml':
				'name: fresh\ndescription: A brief description of what this skill does.\n',
			'commands/fresh.md': `---
description: Do the thing.
---
Do the thing.
`,
		});

		const report = await checkSkillBundle(projectRoot, 'fresh');
		t.true(report.ok);
		t.true(
			report.issues.some(
				i => i.severity === 'warning' && /placeholder/.test(i.message),
			),
		);
	});
});
