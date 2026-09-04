import test from 'ava';
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {parseCommandFile} from '@/custom-commands/parser';
import {
	initializeProject,
	ProjectAlreadyInitializedError,
} from '@/init/initializer';
import {UnknownPresetError} from '@/init/preset-registry';

function createTestProject(): string {
	return mkdtempSync(join(tmpdir(), 'nanocoder-preset-'));
}

function removeTestProject(projectPath: string): void {
	rmSync(projectPath, {recursive: true, force: true});
}

const presetExpectations = {
	react: {
		projectType: 'React Web Application',
		ignorePattern: '*.tsbuildinfo',
		commandText: 'React project quality checks',
	},
	nextjs: {
		projectType: 'Next.js Web Application',
		ignorePattern: 'next-env.d.ts',
		commandText: 'Next.js project quality checks',
	},
	rust: {
		projectType: 'Rust Application',
		ignorePattern: '*.profraw',
		commandText: 'Rust project quality checks',
	},
} as const;

for (const [preset, expectation] of Object.entries(presetExpectations)) {
	test.serial(`initializeProject generates the ${preset} preset`, t => {
		const projectPath = createTestProject();
		try {
			const result = initializeProject({projectPath, preset});
			const agents = readFileSync(join(projectPath, 'AGENTS.md'), 'utf-8');
			const ignore = readFileSync(
				join(projectPath, '.nanocoderignore'),
				'utf-8',
			);
			const command = readFileSync(
				join(projectPath, '.nanocoder', 'commands', 'check.md'),
				'utf-8',
			);
			const parsedCommand = parseCommandFile(
				join(projectPath, '.nanocoder', 'commands', 'check.md'),
			);

			t.is(result.preset, preset);
			t.true(agents.includes(`**Project Type:** ${expectation.projectType}`));
			t.true(ignore.includes(expectation.ignorePattern));
			t.true(command.includes(expectation.commandText));
			t.true(command.includes('description:'));
			t.truthy(parsedCommand.metadata.description);
			t.true(parsedCommand.content.length > 0);
			t.deepEqual(result.preserved, []);
		} finally {
			removeTestProject(projectPath);
		}
	});
}

test.serial('initializeProject keeps existing behavior without a preset', t => {
	const projectPath = createTestProject();
	try {
		const result = initializeProject({projectPath});

		t.true(existsSync(join(projectPath, 'AGENTS.md')));
		t.true(existsSync(join(projectPath, '.nanocoder')));
		t.false(existsSync(join(projectPath, '.nanocoderignore')));
		t.false(
			existsSync(join(projectPath, '.nanocoder', 'commands', 'check.md')),
		);
		t.is(result.preset, undefined);
		t.deepEqual(result.created, ['AGENTS.md', '.nanocoder/']);
	} finally {
		removeTestProject(projectPath);
	}
});

test.serial('initializeProject rejects an invalid preset before writing files', t => {
	const projectPath = createTestProject();
	try {
		const error = t.throws(() =>
			initializeProject({projectPath, preset: 'unknown'}),
		);
		t.true(error instanceof UnknownPresetError);
		t.regex(error.message, /Supported presets: react, nextjs, rust/);
		t.false(existsSync(join(projectPath, 'AGENTS.md')));
		t.false(existsSync(join(projectPath, '.nanocoder')));
	} finally {
		removeTestProject(projectPath);
	}
});

test.serial(
	'initializeProject only includes React preset commands backed by package scripts',
	t => {
		const projectPath = createTestProject();
		try {
			writeFileSync(
				join(projectPath, 'package.json'),
				JSON.stringify({
					dependencies: {react: '^19.0.0'},
					scripts: {
						build: 'vite build',
						test: 'vitest run',
					},
				}),
			);

			const result = initializeProject({projectPath, preset: 'react'});
			const agents = readFileSync(join(projectPath, 'AGENTS.md'), 'utf-8');

			t.deepEqual(result.analysis.buildCommands, {
				Build: 'npm run build',
				Test: 'npm run test',
			});
			t.true(agents.includes('npm run build'));
			t.true(agents.includes('npm run test'));
			t.false(agents.includes('npm run dev'));
			t.false(agents.includes('npm run lint'));
		} finally {
			removeTestProject(projectPath);
		}
	},
);

test.serial(
	'initializeProject includes React preset commands whose package scripts exist',
	t => {
		const projectPath = createTestProject();
		try {
			writeFileSync(
				join(projectPath, 'package.json'),
				JSON.stringify({
					dependencies: {react: '^19.0.0'},
					scripts: {
						dev: 'vite',
						build: 'vite build',
						test: 'vitest run',
						lint: 'eslint .',
					},
				}),
			);

			const result = initializeProject({projectPath, preset: 'React'});
			const agents = readFileSync(join(projectPath, 'AGENTS.md'), 'utf-8');

			t.deepEqual(result.analysis.buildCommands, {
				Development: 'npm run dev',
				Build: 'npm run build',
				Test: 'npm run test',
				Lint: 'npm run lint',
			});
			t.is(result.preset, 'react');
			for (const command of Object.values(result.analysis.buildCommands)) {
				t.true(agents.includes(command));
			}
		} finally {
			removeTestProject(projectPath);
		}
	},
);

test.serial('initializeProject preserves existing preset files with --force', t => {
	const projectPath = createTestProject();
	const existingAgents = '# Existing instructions';
	const existingIgnore = 'keep-this-ignore\n';
	const existingCommand = 'keep this command\n';
	try {
		mkdirSync(join(projectPath, '.nanocoder', 'commands'), {recursive: true});
		writeFileSync(join(projectPath, 'AGENTS.md'), existingAgents);
		writeFileSync(join(projectPath, '.nanocoderignore'), existingIgnore);
		writeFileSync(
			join(projectPath, '.nanocoder', 'commands', 'check.md'),
			existingCommand,
		);

		const result = initializeProject({
			projectPath,
			preset: 'react',
			forceRegenerate: true,
		});

		t.not(readFileSync(join(projectPath, 'AGENTS.md'), 'utf-8'), existingAgents);
		t.is(
			readFileSync(join(projectPath, '.nanocoderignore'), 'utf-8'),
			existingIgnore,
		);
		t.is(
			readFileSync(
				join(projectPath, '.nanocoder', 'commands', 'check.md'),
				'utf-8',
			),
			existingCommand,
		);
		t.deepEqual(result.preserved, [
			'.nanocoderignore',
			'.nanocoder/commands/check.md',
		]);
		t.true(result.created.includes('AGENTS.md (regenerated)'));
	} finally {
		removeTestProject(projectPath);
	}
});

test.serial('initializeProject refuses an initialized project without --force', t => {
	const projectPath = createTestProject();
	try {
		mkdirSync(join(projectPath, '.nanocoder'));
		writeFileSync(join(projectPath, 'AGENTS.md'), '# Existing instructions');

		const error = t.throws(() => initializeProject({projectPath}));
		t.true(error instanceof ProjectAlreadyInitializedError);
		t.is(
			readFileSync(join(projectPath, 'AGENTS.md'), 'utf-8'),
			'# Existing instructions',
		);
	} finally {
		removeTestProject(projectPath);
	}
});
