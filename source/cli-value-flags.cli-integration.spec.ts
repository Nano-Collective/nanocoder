import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import test from 'ava';

// Run the real CLI, replacing only runtime boundaries. In particular, argument
// extraction, validation, context parsing and prompt filtering are not mocked.
const runtimeModules = {
	'@/models/index': `export function setSessionContextLimit(value) {
		globalThis.cliTestContextLimit = value;
	}`,
	'@/app': 'export default function App() {}',
	'@/utils/perf-buffer': 'export function installPerfBufferGuard() {}',
	// Every export cli.tsx pulls from this module must be stubbed here: the
	// loader short-circuits the whole specifier, so a missing name surfaces as
	// "<name> is not a function" at run time rather than an import error.
	'@/config/preferences': `export function loadPreferences() { return {}; }
		export function getAlternateScreen() { return false; }
		export function getMouseReporting() { return false; }`,
	ink: `export function render(element) {
		console.log(JSON.stringify({...element.props, contextLimit: globalThis.cliTestContextLimit}));
		process.exit(0);
	}`,
};
const loader = `const modules = ${JSON.stringify(runtimeModules)};
function matchModule(specifier) {
	if (Object.hasOwn(modules, specifier)) return modules[specifier];
	for (const [key, val] of Object.entries(modules)) {
		if (key.startsWith('@/')) {
			const sub = key.slice(2);
			const regex = new RegExp(\`[/\\\\\\\\]source[/\\\\\\\\]\${sub}(?:[/\\\\\\\\]index)?(?:\\\\.[a-zA-Z]+)?$\`);
			if (regex.test(specifier)) return val;
		}
	}
	return undefined;
}
export function resolve(specifier, context, nextResolve) {
	const matched = matchModule(specifier);
	if (matched !== undefined) {
		return {url: 'data:text/javascript,' + encodeURIComponent(matched), shortCircuit: true};
	}
	return nextResolve(specifier, context);
}`;
const loaderUrl = `data:text/javascript,${encodeURIComponent(
	`import {register} from 'node:module'; register(${JSON.stringify(
		`data:text/javascript,${encodeURIComponent(loader)}`,
	)});`,
)}`;
const cliPath = fileURLToPath(new URL('./cli.tsx', import.meta.url));

function runCli(args: string[]) {
	return spawnSync(
		process.execPath,
		[
			'--import=tsx',
			'--import',
			loaderUrl,
			cliPath,
			'--no-plain',
			'--no-alt-screen',
			...args,
		],
		{
			encoding: 'utf8',
			timeout: 15_000,
			env: {
				...process.env,
				NODE_DISABLE_COMPILE_CACHE: '1',
				TSX_DISABLE_CACHE: '1',
			},
		},
	);
}

const flags = [
	{
		flag: '--model',
		value: 'qwen2.5:7b',
		property: 'cliModel',
		expected: 'qwen2.5:7b',
	},
	{
		flag: '--provider',
		value: 'ollama',
		property: 'cliProvider',
		expected: 'ollama',
	},
	{
		flag: '--vscode-port',
		value: '3000',
		property: 'vscodePort',
		expected: 3000,
	},
	{
		flag: '--context-max',
		value: '128k',
		property: 'contextLimit',
		expected: 128000,
	},
] as const;

for (const {flag, value, property, expected} of flags) {
	for (const fused of [false, true]) {
		for (const beforeRun of [false, true]) {
			test(`${flag}: ${fused ? 'fused' : 'separate'} ${beforeRun ? 'before' : 'after'} run`, t => {
				const option = fused ? [`${flag}=${value}`] : [flag, value];
				const args = beforeRun
					? [...option, 'run', 'analyze', 'code']
					: ['run', 'analyze', ...option, 'code'];
				const result = runCli(args);
				t.is(result.status, 0, result.stderr);
				const props = JSON.parse(result.stdout);
				t.is(props[property], expected);
				t.is(props.nonInteractivePrompt, 'analyze code');
			});
		}
	}

	test(`${flag}: similarly prefixed unknown flag stays in prompt`, t => {
		const unknown = `${flag}-extra=${value}`;
		const result = runCli(['run', 'analyze', unknown, 'code']);
		t.is(result.status, 0, result.stderr);
		const props = JSON.parse(result.stdout);
		t.is(props[property], undefined);
		t.is(props.nonInteractivePrompt, `analyze ${unknown} code`);
	});

	test(`${flag}: missing and empty values retain unset behavior`, t => {
		for (const option of [[flag], [flag, ''], [`${flag}=`]]) {
			const result = runCli(['run', 'analyze code', ...option]);
			t.is(result.status, 0, result.stderr);
			const props = JSON.parse(result.stdout);
			t.is(props[property], undefined);
			t.is(props.nonInteractivePrompt, 'analyze code');
		}
	});

	test(`${flag}: first occurrence wins across both forms`, t => {
		for (const firstFused of [false, true]) {
			for (const secondFused of [false, true]) {
				const first = firstFused ? [`${flag}=${value}`] : [flag, value];
				const second = secondFused ? [`${flag}=invalid!`] : [flag, 'invalid!'];
				const result = runCli([...first, 'run', 'analyze', ...second, 'code']);
				t.is(result.status, 0, result.stderr);
				const props = JSON.parse(result.stdout);
				t.is(props[property], expected);
				t.is(props.nonInteractivePrompt, 'analyze code');
			}
		}
	});
}

test('fused values preserve additional equals signs for existing validation', t => {
	for (const flag of ['--model', '--provider', '--context-max']) {
		const result = runCli(['run', 'hello', `${flag}=123=extra`]);
		t.is(result.status, 1);
		t.true(
			result.stderr.includes(`Invalid ${flag} value: "123=extra"`),
			result.stderr,
		);
	}
	// Port parsing intentionally continues to accept a numeric prefix.
	const result = runCli(['run', 'hello', '--vscode-port=3000=extra', 'world']);
	t.is(result.status, 0, result.stderr);
	const props = JSON.parse(result.stdout);
	t.is(props.vscodePort, 3000);
	t.is(props.nonInteractivePrompt, 'hello world');
});

test('all four fused flags are removed without consuming prompt words', t => {
	const result = runCli([
		'run',
		'analyze',
		...flags.map(({flag, value}) => `${flag}=${value}`),
		'code',
	]);
	t.is(result.status, 0, result.stderr);
	const props = JSON.parse(result.stdout);
	for (const {property, expected} of flags) t.is(props[property], expected);
	t.is(props.nonInteractivePrompt, 'analyze code');
});
