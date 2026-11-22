import test from 'ava';
import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'fs';
import {tmpdir} from 'os';
import {dirname, join} from 'path';
import {
	createSessionContext,
	runInSessionContext,
} from '@/services/session-context';
import {getAppConfig} from './index';
import {
	DEFAULT_INSTRUCTION_FILES,
	findProjectInstructionFile,
	getInstructionFileNames,
	loadProjectInstructionFile,
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
			const found = findProjectInstructionFile();
			t.is(found?.name, 'AGENTS.md');
			t.is(found?.path, join(root, 'AGENTS.md'));
		},
	);
});

test('findProjectInstructionFile - falls back to well-known instruction files', t => {
	for (const name of DEFAULT_INSTRUCTION_FILES) {
		withProject({[name]: 'RULES'}, () => {
			t.is(findProjectInstructionFile()?.name, name);
		});
	}
});

test('findProjectInstructionFile - respects the configured order', t => {
	withProject(
		{
			'CLAUDE.md': 'CLAUDE RULES',
			'GEMINI.md': 'GEMINI RULES',
		},
		() => {
			withConfiguredFiles(['GEMINI.md', 'CLAUDE.md'], () => {
				t.is(findProjectInstructionFile()?.name, 'GEMINI.md');
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
		() => {
			t.is(findProjectInstructionFile()?.name, 'GEMINI.md');
		},
	);
});

test('findProjectInstructionFile - returns null when nothing is present', t => {
	withProject({}, () => {
		t.is(findProjectInstructionFile(), null);
	});
});

test('loadProjectInstructionFile - reads the first available file', t => {
	withProject(
		{
			'AGENTS.md': 'AGENTS RULES',
			'CLAUDE.md': 'CLAUDE RULES',
		},
		root => {
			const file = loadProjectInstructionFile();
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
		() => {
			t.is(loadProjectInstructionFile()?.content, 'GEMINI RULES');
		},
	);
});
