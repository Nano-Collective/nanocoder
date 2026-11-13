import test from 'ava';
import {FILE_TYPE_MAP, getFileType} from './file-type-detector';

// Test getFileType with paths
test('getFileType detects TypeScript from path', t => {
	t.is(getFileType('src/app.ts'), 'TypeScript');
	t.is(getFileType('component.tsx'), 'TypeScript React');
});

test('getFileType detects JavaScript from path', t => {
	t.is(getFileType('index.js'), 'JavaScript');
	t.is(getFileType('App.jsx'), 'JavaScript React');
	t.is(getFileType('module.mjs'), 'JavaScript Module');
	t.is(getFileType('legacy.cjs'), 'CommonJS');
});

test('getFileType detects other languages', t => {
	t.is(getFileType('main.py'), 'Python');
	t.is(getFileType('main.go'), 'Go');
	t.is(getFileType('main.rs'), 'Rust');
	t.is(getFileType('Main.java'), 'Java');
});

test('getFileType detects markup/data formats', t => {
	t.is(getFileType('README.md'), 'Markdown');
	t.is(getFileType('config.json'), 'JSON');
	t.is(getFileType('config.yaml'), 'YAML');
	t.is(getFileType('config.yml'), 'YAML');
});

test('getFileType detects styles', t => {
	t.is(getFileType('styles.css'), 'CSS');
	t.is(getFileType('styles.scss'), 'SCSS');
});

test('getFileType handles extension-only input', t => {
	t.is(getFileType('ts'), 'TypeScript');
	t.is(getFileType('py'), 'Python');
});

test('getFileType returns uppercase extension for unknown types', t => {
	t.is(getFileType('file.xyz'), 'XYZ');
	t.is(getFileType('file.custom'), 'CUSTOM');
});

test('getFileType handles files without extension', t => {
	t.is(getFileType('Makefile'), 'MAKEFILE');  // Returns uppercase extension
	t.is(getFileType(''), 'Unknown');
});

test('getFileType is case insensitive', t => {
	t.is(getFileType('file.TS'), 'TypeScript');
	t.is(getFileType('file.PY'), 'Python');
});

test('FILE_TYPE_MAP contains all expected extensions', t => {
	const expectedExtensions = [
		'ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs',
		'py', 'go', 'rs', 'java',
		'md', 'json', 'yaml', 'yml',
		'css', 'scss',
		'sh', 'bash'
	];

	for (const ext of expectedExtensions) {
		t.truthy(FILE_TYPE_MAP[ext], `FILE_TYPE_MAP should contain ${ext}`);
	}
});
