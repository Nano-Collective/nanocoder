import test from 'ava';
import {mkdtempSync, mkdirSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {MAX_TOOL_RESULT_CHARS} from '@/constants';
import {expandAgentsMdImports} from './agents-md-imports.js';

console.log('\nagents-md-imports.spec.ts');

/**
 * Build a throwaway project. Every test gets its own directory so relative and
 * escaping imports mean exactly what they say.
 */
function makeProject(): string {
	return mkdtempSync(join(tmpdir(), 'nc-agents-imports-'));
}

function write(root: string, relative: string, content: string): void {
	const filePath = join(root, relative);
	mkdirSync(join(filePath, '..'), {recursive: true});
	writeFileSync(filePath, content);
}

function expand(root: string, content: string, extra: Record<string, unknown> = {}) {
	return expandAgentsMdImports(content, {
		filePath: join(root, 'AGENTS.md'),
		projectRoot: root,
		configDir: join(root, '.config'),
		...extra,
	});
}

test('expands a relative import into the file contents', t => {
	const root = makeProject();
	try {
		write(root, 'docs/testing.md', 'Always run the test suite.');
		const result = expand(root, '# Rules\n@docs/testing.md\nAfter.');
		t.is(result.warnings.length, 0);
		t.is(result.content, '# Rules\nAlways run the test suite.\nAfter.');
	} finally {
		rmSync(root, {recursive: true, force: true});
	}
});

test('resolves nested imports relative to the importing file', t => {
	const root = makeProject();
	try {
		write(root, 'docs/testing.md', 'Run tests.\n@fixtures/helpers.md');
		write(root, 'docs/fixtures/helpers.md', 'Use the shared helpers.');
		const result = expand(root, '@docs/testing.md');
		t.is(result.warnings.length, 0);
		t.is(result.content, 'Run tests.\nUse the shared helpers.');
	} finally {
		rmSync(root, {recursive: true, force: true});
	}
});

test('leaves @paths inside fenced code blocks untouched', t => {
	const root = makeProject();
	try {
		write(root, 'docs/testing.md', 'Expanded.');
		const content = [
			'Documenting the syntax:',
			'```markdown',
			'@docs/testing.md',
			'```',
			'@docs/testing.md',
		].join('\n');
		const result = expand(root, content);
		t.is(result.warnings.length, 0);
		t.true(result.content.includes('```markdown\n@docs/testing.md\n```'));
		t.true(result.content.endsWith('\nExpanded.'));
	} finally {
		rmSync(root, {recursive: true, force: true});
	}
});

test('a longer fence is not closed by a shorter one inside it', t => {
	const root = makeProject();
	try {
		write(root, 'docs/testing.md', 'Expanded.');
		// Valid Markdown: a ```` block may contain ``` blocks.
		const content = [
			'````markdown',
			'```md',
			'@docs/testing.md',
			'```',
			'````',
		].join('\n');
		const result = expand(root, content);
		t.is(result.warnings.length, 0);
		t.is(result.content, content);
	} finally {
		rmSync(root, {recursive: true, force: true});
	}
});

test('a bare @word on its own line is prose, not a missing import', t => {
	const root = makeProject();
	try {
		const result = expand(root, '@TODO pick a name\n@decorator');
		t.deepEqual(result.warnings, []);
		t.is(result.content, '@TODO pick a name\n@decorator');
	} finally {
		rmSync(root, {recursive: true, force: true});
	}
});

test('leaves inline mentions in prose untouched', t => {
	const root = makeProject();
	try {
		write(root, 'docs/testing.md', 'Expanded.');
		const result = expand(root, 'See @docs/testing.md for details.');
		t.is(result.warnings.length, 0);
		t.is(result.content, 'See @docs/testing.md for details.');
	} finally {
		rmSync(root, {recursive: true, force: true});
	}
});

test('reports a missing import and leaves the reference in place', t => {
	const root = makeProject();
	try {
		const result = expand(root, '@docs/missing.md');
		t.deepEqual(result.warnings, [
			'AGENTS.md: @docs/missing.md was not imported (file not found)',
		]);
		t.is(result.content, '@docs/missing.md');
	} finally {
		rmSync(root, {recursive: true, force: true});
	}
});

test('names the importing file when a nested import fails', t => {
	const root = makeProject();
	try {
		// The reference lives in docs/testing.md, so that is the file to open.
		write(root, 'docs/testing.md', '@missing.md');
		const result = expand(root, '@docs/testing.md');
		t.deepEqual(result.warnings, [
			'docs/testing.md: @missing.md was not imported (file not found)',
		]);
	} finally {
		rmSync(root, {recursive: true, force: true});
	}
});

test('refuses an import that escapes the project root', t => {
	const root = makeProject();
	const outside = mkdtempSync(join(tmpdir(), 'nc-agents-outside-'));
	try {
		write(outside, 'secret.md', 'NOT PROJECT CONTENT');
		const relative = join('..', outside.split(/[/\\]/).pop() ?? '');
		const result = expand(root, `@${relative}/secret.md`);
		t.is(result.warnings.length, 1);
		t.true(result.warnings[0]?.includes('outside the project root') ?? false);
		t.false(result.content.includes('NOT PROJECT CONTENT'));
	} finally {
		rmSync(root, {recursive: true, force: true});
		rmSync(outside, {recursive: true, force: true});
	}
});

test('refuses an absolute import', t => {
	const root = makeProject();
	try {
		const result = expand(root, '@/etc/passwd');
		t.is(result.warnings.length, 1);
		t.true(result.warnings[0]?.includes('absolute paths') ?? false);
	} finally {
		rmSync(root, {recursive: true, force: true});
	}
});

test('expands a ~ import only inside the user config directory', t => {
	const root = makeProject();
	const home = makeProject();
	try {
		write(home, 'config/rules/style.md', 'House style.');
		const allowed = expand(root, '@~/config/rules/style.md', {
			homeDir: home,
			configDir: join(home, 'config'),
		});
		t.is(allowed.warnings.length, 0);
		t.is(allowed.content, 'House style.');

		// Rest of the home directory stays off limits: a cloned repository must
		// not be able to pull `~/.ssh` or notes into the prompt.
		write(home, 'secrets.md', 'NOT SHARED');
		const refused = expand(root, '@~/secrets.md', {homeDir: home});
		t.is(refused.warnings.length, 1);
		t.true(refused.warnings[0]?.includes('outside the project root') ?? false);
		t.false(refused.content.includes('NOT SHARED'));
	} finally {
		rmSync(root, {recursive: true, force: true});
		rmSync(home, {recursive: true, force: true});
	}
});

test('a circular import is reported and not expanded again', t => {
	const root = makeProject();
	try {
		write(root, 'a.md', '@b.md');
		write(root, 'b.md', '@a.md');
		const result = expand(root, '@a.md');
		t.is(result.warnings.length, 1);
		t.true(result.warnings[0]?.includes('circular import') ?? false);
	} finally {
		rmSync(root, {recursive: true, force: true});
	}
});

test('stops at the configured nesting depth', t => {
	const root = makeProject();
	try {
		write(root, 'one.md', '@two.md');
		write(root, 'two.md', '@three.md');
		write(root, 'three.md', 'deep');
		const result = expand(root, '@one.md', {maxDepth: 1});
		t.is(result.warnings.length, 1);
		t.true(result.warnings[0]?.includes('nested too deeply') ?? false);
		t.false(result.content.includes('deep'));
	} finally {
		rmSync(root, {recursive: true, force: true});
	}
});

test('caps a single imported file like tool output', t => {
	const root = makeProject();
	try {
		write(root, 'huge.md', 'y'.repeat(MAX_TOOL_RESULT_CHARS + 500));
		const result = expand(root, '@huge.md');
		t.is(result.warnings.length, 0);
		t.true(result.content.includes('Output truncated'));
		t.true(result.content.length < MAX_TOOL_RESULT_CHARS + 500);
	} finally {
		rmSync(root, {recursive: true, force: true});
	}
});

test('stops importing once the total size budget is exhausted', t => {
	const root = makeProject();
	try {
		write(root, 'big.md', 'z'.repeat(50));
		const result = expand(root, '@big.md', {maxChars: 10});
		t.is(result.warnings.length, 1);
		t.true(result.warnings[0]?.includes('size budget') ?? false);
		t.is(result.content, '@big.md');
	} finally {
		rmSync(root, {recursive: true, force: true});
	}
});
