import test from 'ava';
import {
	mkdirSync,
	mkdtempSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from 'fs';
import {tmpdir} from 'os';
import {dirname, join} from 'path';
import {MAX_TOOL_RESULT_CHARS} from '@/constants';
import {
	createSessionContext,
	runInSessionContext,
} from '@/services/session-context';
import {getAppConfig} from '@/config/index';
import type {TuneConfig} from '@/types/config';
import {
	DEFAULT_INSTRUCTION_FILES,
	findProjectInstructionFile,
	getInstructionFileNames,
	loadProjectInstructionFile,
	shouldIncludeProjectInstructions,
} from './instruction-files';

console.log('\ninstruction-files.spec.ts');

function withProject<T>(files: Record<string, string>, run: (root: string) => T): T {
	const root = mkdtempSync(join(tmpdir(), 'nc-instruction-files-'));
	try {
		for (const [name, content] of Object.entries(files)) {
			const path = join(root, name);
			mkdirSync(dirname(path), {recursive: true});
			writeFileSync(path, content, 'utf-8');
		}
		return runInSessionContext(createSessionContext(root), () => run(root));
	} finally {
		rmSync(root, {recursive: true, force: true});
	}
}

function withConfiguredFiles<T>(value: string[] | undefined, run: () => T): T {
	const config = getAppConfig();
	const original = config.instructionFiles;
	try {
		if (value === undefined) delete config.instructionFiles;
		else config.instructionFiles = value;
		return run();
	} finally {
		if (original === undefined) delete config.instructionFiles;
		else config.instructionFiles = original;
	}
}

test('shouldIncludeProjectInstructions - explicit false wins and nano opts out by default', t => {
	const normal: TuneConfig = {
		enabled: true,
		toolProfile: 'full',
		aggressiveCompact: false,
	};
	const nano: TuneConfig = {...normal, toolProfile: 'nano'};
	t.true(shouldIncludeProjectInstructions(normal));
	t.false(shouldIncludeProjectInstructions(nano));
	t.true(shouldIncludeProjectInstructions({...nano, includeAgentsMd: true}));
	t.false(
		shouldIncludeProjectInstructions({...normal, includeAgentsMd: false}),
	);
});

test('getInstructionFileNames - AGENTS.md comes first followed by the defaults', t => {
	withConfiguredFiles(undefined, () => {
		t.deepEqual(getInstructionFileNames(), [
			'AGENTS.md',
			...DEFAULT_INSTRUCTION_FILES,
		]);
	});
});

test('getInstructionFileNames - a configured list replaces the defaults', t => {
	withConfiguredFiles(['GEMINI.md', 'CLAUDE.md'], () => {
		t.deepEqual(getInstructionFileNames(), [
			'AGENTS.md',
			'GEMINI.md',
			'CLAUDE.md',
		]);
	});
});

test('getInstructionFileNames - an empty list disables fallbacks and dedupes AGENTS.md', t => {
	withConfiguredFiles([], () => {
		t.deepEqual(getInstructionFileNames(), ['AGENTS.md']);
	});

	withConfiguredFiles(['agents.md', 'CLAUDE.md', 'claude.md'], () => {
		t.deepEqual(getInstructionFileNames(), ['AGENTS.md', 'CLAUDE.md']);
	});
});

test('findProjectInstructionFile - prefers AGENTS.md over fallbacks', t => {
	withProject(
		{
			'AGENTS.md': 'AGENTS RULES',
			'CLAUDE.md': 'CLAUDE RULES',
		},
		root => {
			const found = findProjectInstructionFile(root);
			t.is(found?.name, 'AGENTS.md');
			t.is(found?.path, join(root, 'AGENTS.md'));
		},
	);
});

test('findProjectInstructionFile - falls back to well-known instruction files', t => {
	for (const name of DEFAULT_INSTRUCTION_FILES) {
		withProject({[name]: 'RULES'}, root => {
			t.is(findProjectInstructionFile(root)?.name, name);
		});
	}
});

test('findProjectInstructionFile - respects the configured order', t => {
	withProject(
		{
			'CLAUDE.md': 'CLAUDE RULES',
			'GEMINI.md': 'GEMINI RULES',
		},
		root => {
			withConfiguredFiles(['GEMINI.md', 'CLAUDE.md'], () => {
				t.is(findProjectInstructionFile(root)?.name, 'GEMINI.md');
			});
		},
	);
});

test('findProjectInstructionFile - skips directories named like instruction files', t => {
	withProject(
		{
			// A directory is not an instruction file, even though it exists.
			'CLAUDE.md/notes.txt': 'not instructions',
			'GEMINI.md': 'GEMINI RULES',
		},
		root => {
			t.is(findProjectInstructionFile(root)?.name, 'GEMINI.md');
		},
	);
});

test('findProjectInstructionFile - returns null when nothing is present', t => {
	withProject({}, root => {
		t.is(findProjectInstructionFile(root), null);
	});
});

test('loadProjectInstructionFile - reads the first available file', t => {
	withProject(
		{
			'AGENTS.md': 'AGENTS RULES',
			'CLAUDE.md': 'CLAUDE RULES',
		},
		root => {
			const file = loadProjectInstructionFile(root);
			t.is(file?.name, 'AGENTS.md');
			t.is(file?.path, join(root, 'AGENTS.md'));
			t.is(file?.content, 'AGENTS RULES');
		},
	);
});

test('loadProjectInstructionFile - skips candidates that cannot be read', t => {
	withProject(
		{
			// readFileSync fails on a directory; the next fallback must win.
			'CLAUDE.md/notes.txt': 'not instructions',
			'GEMINI.md': 'GEMINI RULES',
		},
		root => {
			t.is(loadProjectInstructionFile(root)?.content, 'GEMINI RULES');
		},
	);
});

test('loadProjectInstructionFile - refuses an ignored candidate', t => {
	withProject(
		{
			'.gitignore': 'CLAUDE.md\n',
			'CLAUDE.md': 'SECRET RULES',
			'GEMINI.md': 'GEMINI RULES',
		},
		root => {
			withConfiguredFiles(['CLAUDE.md', 'GEMINI.md'], () => {
				// /status and /doctor use the same check as the prompt builder.
				t.is(findProjectInstructionFile(root)?.name, 'GEMINI.md');
				t.is(loadProjectInstructionFile(root)?.content, 'GEMINI RULES');
			});
		},
	);
});

test('loadProjectInstructionFile - refuses paths inside the git directory', t => {
	withProject({'.git/config': 'token = secret'}, root => {
		withConfiguredFiles(['.git/config'], () => {
			t.is(findProjectInstructionFile(root), null);
			t.is(loadProjectInstructionFile(root), null);
		});
	});
});

test('loadProjectInstructionFile - refuses an in-project symlink to an outside file', t => {
	const root = mkdtempSync(join(tmpdir(), 'nc-instruction-link-project-'));
	const outside = mkdtempSync(join(tmpdir(), 'nc-instruction-link-outside-'));
	try {
		writeFileSync(join(outside, 'secret.md'), 'OUTSIDE SECRET');
		try {
			symlinkSync(join(outside, 'secret.md'), join(root, 'CLAUDE.md'), 'file');
		} catch (error) {
			// Windows needs Developer Mode or elevation to create file symlinks.
			if ((error as NodeJS.ErrnoException).code === 'EPERM') {
				t.pass('symlink creation is not permitted on this host');
				return;
			}
			throw error;
		}
		writeFileSync(join(root, 'GEMINI.md'), 'GEMINI RULES');

		t.is(findProjectInstructionFile(root)?.name, 'GEMINI.md');
		t.is(loadProjectInstructionFile(root)?.content, 'GEMINI RULES');
	} finally {
		rmSync(root, {recursive: true, force: true});
		rmSync(outside, {recursive: true, force: true});
	}
});

test('loadProjectInstructionFile - caps oversized files like tool output', t => {
	withProject(
		{'AGENTS.md': 'x'.repeat(MAX_TOOL_RESULT_CHARS + 1_000)},
		root => {
			const file = loadProjectInstructionFile(root);
			t.truthy(file);
			t.true((file?.content.length ?? 0) <= MAX_TOOL_RESULT_CHARS);
			t.regex(file?.content ?? '', /Output truncated/);
		},
	);
});
