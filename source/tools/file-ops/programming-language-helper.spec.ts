import test from 'ava';
import { getLanguageFromExtension } from './programming-language-helper';

test('getLanguageFromExtension - returns javascript for JavaScript files', t => {
	t.is(getLanguageFromExtension('js'), 'javascript');
	t.is(getLanguageFromExtension('jsx'), 'javascript');
});

test('getLanguageFromExtension - returns typescript for TypeScript files', t => {
	t.is(getLanguageFromExtension('ts'), 'typescript');
	t.is(getLanguageFromExtension('tsx'), 'typescript');
});

test('getLanguageFromExtension - returns correct language for scripting languages', t => {
	t.is(getLanguageFromExtension('py'), 'python');
	t.is(getLanguageFromExtension('rb'), 'ruby');
	t.is(getLanguageFromExtension('go'), 'go');
});

test('getLanguageFromExtension - returns correct language for compiled languages', t => {
	t.is(getLanguageFromExtension('rs'), 'rust');
	t.is(getLanguageFromExtension('java'), 'java');
	t.is(getLanguageFromExtension('cpp'), 'cpp');
	t.is(getLanguageFromExtension('c'), 'c');
	t.is(getLanguageFromExtension('cs'), 'csharp');
	t.is(getLanguageFromExtension('php'), 'php');
});

test('getLanguageFromExtension - returns correct language for web technologies', t => {
	t.is(getLanguageFromExtension('html'), 'html');
	t.is(getLanguageFromExtension('css'), 'css');
	t.is(getLanguageFromExtension('scss'), 'scss');
});

test('getLanguageFromExtension - returns correct language for data formats', t => {
	t.is(getLanguageFromExtension('json'), 'json');
	t.is(getLanguageFromExtension('yaml'), 'yaml');
	t.is(getLanguageFromExtension('yml'), 'yaml');
	t.is(getLanguageFromExtension('xml'), 'xml');
	t.is(getLanguageFromExtension('md'), 'markdown');
});

test('getLanguageFromExtension - returns bash for all shell variants', t => {
	t.is(getLanguageFromExtension('sh'), 'bash');
	t.is(getLanguageFromExtension('bash'), 'bash');
	t.is(getLanguageFromExtension('zsh'), 'bash');
	t.is(getLanguageFromExtension('fish'), 'bash');
});

test('getLanguageFromExtension - returns sql for SQL files', t => {
	t.is(getLanguageFromExtension('sql'), 'sql');
});

test('getLanguageFromExtension - returns javascript for undefined extension', t => {
	t.is(getLanguageFromExtension(undefined), 'javascript');
});

test('getLanguageFromExtension - returns javascript for empty string extension', t => {
	t.is(getLanguageFromExtension(''), 'javascript');
});

test('getLanguageFromExtension - returns javascript for unknown extensions', t => {
	t.is(getLanguageFromExtension('unknown'), 'javascript');
	t.is(getLanguageFromExtension('xyz'), 'javascript');
	t.is(getLanguageFromExtension('exe'), 'javascript');
	t.is(getLanguageFromExtension('txt'), 'javascript');
});

test('getLanguageFromExtension - is case sensitive', t => {
	// The function doesn't convert to lowercase, so it should return javascript for uppercase
	t.is(getLanguageFromExtension('JS'), 'javascript');
	t.is(getLanguageFromExtension('TS'), 'javascript');
	t.is(getLanguageFromExtension('PY'), 'javascript');
});