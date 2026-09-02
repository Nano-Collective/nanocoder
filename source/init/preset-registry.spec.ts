import test from 'ava';
import {
	applyPresetToAnalysis,
	resolvePreset,
	supportedPresetNames,
	UnknownPresetError,
} from '@/init/preset-registry';
import type {ProjectAnalysis} from '@/init/project-analyzer';

test('preset registry exposes the supported preset names', t => {
	t.deepEqual(supportedPresetNames, ['react', 'nextjs', 'rust']);
});

for (const name of supportedPresetNames) {
	test(`preset registry resolves ${name}`, t => {
		const preset = resolvePreset(name);
		t.is(preset.name, name);
		t.true(preset.files.some(file => file.path === '.nanocoderignore'));
		t.true(
			preset.files.some(file => file.path === '.nanocoder/commands/check.md'),
		);
	});
}

test('preset registry reports unknown presets and all supported names', t => {
	const error = t.throws(() => resolvePreset('vue'));
	t.true(error instanceof UnknownPresetError);
	t.is(
		error.message,
		'Unknown preset "vue". Supported presets: react, nextjs, rust.',
	);
});

for (const inheritedName of ['constructor', 'toString', '__proto__']) {
	test(`preset registry rejects inherited property ${inheritedName}`, t => {
		const error = t.throws(() => resolvePreset(inheritedName));
		t.true(error instanceof UnknownPresetError);
		t.is(
			error.message,
			`Unknown preset "${inheritedName}". Supported presets: react, nextjs, rust.`,
		);
	});
}

test('preset registry normalizes case and whitespace', t => {
	t.is(resolvePreset('  React  ').name, 'react');
});

test('preset registry preserves the user-provided value in errors', t => {
	const error = t.throws(() => resolvePreset('  Vue  '));
	t.true(error instanceof UnknownPresetError);
	t.is(
		error.message,
		'Unknown preset "  Vue  ". Supported presets: react, nextjs, rust.',
	);
});

test('preset commands require package scripts and detected commands win', t => {
	const analysis: ProjectAnalysis = {
		projectPath: '/project',
		projectName: 'example',
		languages: {primary: null, secondary: [], all: []},
		dependencies: {
			frameworks: [],
			buildTools: [],
			testingFrameworks: [],
			buildInfo: {scripts: {build: 'custom-build'}},
		},
		projectType: 'Unknown',
		keyFiles: {config: [], documentation: [], build: [], test: []},
		structure: {
			totalFiles: 0,
			scannedFiles: 0,
			directories: [],
			importantDirectories: [],
		},
		buildCommands: {Build: 'pnpm run custom-build'},
	};

	const result = applyPresetToAnalysis(analysis, resolvePreset('react'));
	t.deepEqual(result.buildCommands, {Build: 'pnpm run custom-build'});
});

test('Rust preset keeps Cargo.lock available as project context', t => {
	const ignoreFile = resolvePreset('rust').files.find(
		file => file.path === '.nanocoderignore',
	);
	t.truthy(ignoreFile);
	t.false(ignoreFile?.content.includes('Cargo.lock'));
});

for (const presetName of supportedPresetNames) {
	test(`${presetName} preset check command declares no aliases`, t => {
		const checkFile = resolvePreset(presetName).files.find(
			file => file.path === '.nanocoder/commands/check.md',
		);
		t.truthy(checkFile);
		t.false(checkFile?.content.includes('aliases:'));
	});
}
