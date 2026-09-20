import test from 'ava';
import {
	parseSkillManifestContent,
	SkillManifestParseError,
} from './manifest-parser';

console.log(`\nmanifest-parser.spec.ts`);

const MINIMAL = `
name: k8s
description: Kubernetes operational helpers.
`;

test('parses a minimal manifest', t => {
	const m = parseSkillManifestContent(MINIMAL);
	t.is(m.name, 'k8s');
	t.is(m.description, 'Kubernetes operational helpers.');
	t.is(m.version, undefined);
	t.is(m.subscribe, undefined);
	t.is(m.include, undefined);
});

test('parses full metadata', t => {
	const m = parseSkillManifestContent(`
name: pr-reviewer
description: Reviews pull requests.
version: 0.3.1
author: you@example.com
tags: [git, ci, review]
include:
  commands: ["*"]
  agents: ["*"]
  tools: ["gh_pr_diff"]
subscribe:
  - kind: file.changed
    target: agent:reviewer
    paths:
      - "src/**"
    eventKinds: [add, change]
  - kind: schedule.cron
    target: command:weekly-report
    cron: "0 9 * * MON"
    confirm: true
tools_visibility:
  default: scoped
`);
	t.is(m.version, '0.3.1');
	t.is(m.author, 'you@example.com');
	t.deepEqual(m.tags, ['git', 'ci', 'review']);
	t.deepEqual(m.include, {
		commands: ['*'],
		agents: ['*'],
		tools: ['gh_pr_diff'],
	});
	t.is(m.subscribe?.length, 2);
	t.is(m.subscribe?.[0]?.target, 'agent:reviewer');
	t.is(m.subscribe?.[1]?.confirm, true);
	t.deepEqual(m.tools_visibility, {default: 'scoped'});
});

test('rejects missing name', t => {
	t.throws(() => parseSkillManifestContent('description: ok'), {
		instanceOf: SkillManifestParseError,
		message: /missing "name"/i,
	});
});

test('rejects invalid name format', t => {
	t.throws(
		() => parseSkillManifestContent('name: K8s_Helper\ndescription: ok'),
		{
			instanceOf: SkillManifestParseError,
			message: /Invalid or missing "name"/,
		},
	);
});

test('rejects missing description', t => {
	t.throws(() => parseSkillManifestContent('name: ok'), {
		instanceOf: SkillManifestParseError,
		message: /description/i,
	});
});

test('rejects YAML that is not a mapping (top-level list)', t => {
	t.throws(() => parseSkillManifestContent('- one\n- two\n'), {
		instanceOf: SkillManifestParseError,
		message: /not a valid YAML mapping/,
	});
});

test('rejects unparseable YAML', t => {
	t.throws(() => parseSkillManifestContent('name: "unterminated'), {
		instanceOf: SkillManifestParseError,
		message: /not a valid YAML mapping/,
	});
});

test('rejects manifest subscribe entry without target', t => {
	t.throws(
		() =>
			parseSkillManifestContent(`
name: k8s
description: ok
subscribe:
  - kind: file.changed
    paths: ["src/**"]
`),
		{
			instanceOf: SkillManifestParseError,
			message: /target is required/,
		},
	);
});

test('rejects malformed target string', t => {
	t.throws(
		() =>
			parseSkillManifestContent(`
name: k8s
description: ok
subscribe:
  - kind: file.changed
    target: not-a-kind
    paths: ["src/**"]
`),
		{
			instanceOf: SkillManifestParseError,
			message: /must match/,
		},
	);
});

test('rejects absolute path in subscribe.paths', t => {
	t.throws(
		() =>
			parseSkillManifestContent(`
name: k8s
description: ok
subscribe:
  - kind: file.changed
    target: agent:k8s-agent
    paths: ["/etc/passwd"]
`),
		{
			instanceOf: SkillManifestParseError,
			message: /relative path/,
		},
	);
});

test('rejects .. traversal in subscribe.paths', t => {
	t.throws(
		() =>
			parseSkillManifestContent(`
name: k8s
description: ok
subscribe:
  - kind: file.changed
    target: agent:k8s-agent
    paths: ["../outside/**"]
`),
		{
			instanceOf: SkillManifestParseError,
			message: /traverse upward/,
		},
	);
});

test('rejects absolute path in include.commands', t => {
	t.throws(
		() =>
			parseSkillManifestContent(`
name: k8s
description: ok
include:
  commands: ["/abs/path"]
`),
		{
			instanceOf: SkillManifestParseError,
			message: /relative path/,
		},
	);
});

test('rejects invalid tools_visibility', t => {
	t.throws(
		() =>
			parseSkillManifestContent(`
name: k8s
description: ok
tools_visibility:
  default: wibble
`),
		{
			instanceOf: SkillManifestParseError,
			message: /tools_visibility\.default/,
		},
	);
});

test('accepts tools_visibility shorthand string (scoped)', t => {
	const m = parseSkillManifestContent(`
name: k8s
description: ok
tools_visibility: scoped
`);
	t.deepEqual(m.tools_visibility, {default: 'scoped'});
});

test('accepts tools_visibility shorthand string (global)', t => {
	const m = parseSkillManifestContent(`
name: k8s
description: ok
tools_visibility: global
`);
	t.deepEqual(m.tools_visibility, {default: 'global'});
});

test('rejects unknown tools_visibility shorthand value', t => {
	t.throws(
		() =>
			parseSkillManifestContent(`
name: k8s
description: ok
tools_visibility: wibble
`),
		{
			instanceOf: SkillManifestParseError,
			message: /tools_visibility/,
		},
	);
});

test('rejects tags that are not strings', t => {
	t.throws(
		() =>
			parseSkillManifestContent(`
name: k8s
description: ok
tags: [1, 2, 3]
`),
		{
			instanceOf: SkillManifestParseError,
			message: /tags/i,
		},
	);
});

test('rejects include that is not a mapping', t => {
	t.throws(
		() =>
			parseSkillManifestContent(`
name: k8s
description: ok
include: ["commands"]
`),
		{
			instanceOf: SkillManifestParseError,
			message: /include/i,
		},
	);
});

test('subscribe parse errors are surfaced as manifest parse errors', t => {
	t.throws(
		() =>
			parseSkillManifestContent(`
name: k8s
description: ok
subscribe:
  - kind: file.changed
    target: agent:foo
    eventKinds: [rename]
`),
		{
			instanceOf: SkillManifestParseError,
			message: /eventKinds/,
		},
	);
});

test('accepts paths containing .. as a literal segment, not traversal', t => {
	const m = parseSkillManifestContent(`
name: k8s
description: ok
subscribe:
  - kind: file.changed
    target: agent:foo
    paths: ["my..weird..dir/**"]
`);
	t.is(m.subscribe?.[0]?.target, 'agent:foo');
});
