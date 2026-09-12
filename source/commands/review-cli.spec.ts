import test from 'ava';
import {parseReviewCliArgs} from './review-cli';

test('parseReviewCliArgs: returns false for non-review commands', t => {
	t.deepEqual(parseReviewCliArgs(['run', 'hello']), {
		isReviewCommand: false,
		prompt: undefined,
		error: undefined,
	});
	t.deepEqual(parseReviewCliArgs([]), {
		isReviewCommand: false,
		prompt: undefined,
		error: undefined,
	});
});

test('parseReviewCliArgs: anchors on args[0]', t => {
	t.deepEqual(parseReviewCliArgs(['--vscode', 'review', 'main']), {
		isReviewCommand: false,
		prompt: undefined,
		error: undefined,
	});
});

test('parseReviewCliArgs: no args produces /review', t => {
	t.deepEqual(parseReviewCliArgs(['review']), {
		isReviewCommand: true,
		prompt: '/review',
		error: undefined,
	});
});

test('parseReviewCliArgs: branch name', t => {
	t.deepEqual(parseReviewCliArgs(['review', 'feature/auth']), {
		isReviewCommand: true,
		prompt: '/review feature/auth',
		error: undefined,
	});
});

test('parseReviewCliArgs: PR number', t => {
	t.deepEqual(parseReviewCliArgs(['review', '42']), {
		isReviewCommand: true,
		prompt: '/review 42',
		error: undefined,
	});
});

test('parseReviewCliArgs: errors on extra positional args', t => {
	const result = parseReviewCliArgs(['review', 'feature', 'extra', 'args']);
	t.is(result.isReviewCommand, true);
	t.is(result.prompt, undefined);
	t.truthy(result.error);
	t.true(result.error!.includes('Extra arguments'));
	t.true(result.error!.includes('extra'));
});

test('parseReviewCliArgs: errors on exactly two positional args', t => {
	const result = parseReviewCliArgs(['review', 'main', 'other']);
	t.is(result.isReviewCommand, true);
	t.is(result.prompt, undefined);
	t.truthy(result.error);
	t.true(result.error!.includes('other'));
});

test('parseReviewCliArgs: filters --vscode flag', t => {
	t.deepEqual(parseReviewCliArgs(['review', 'main', '--vscode']), {
		isReviewCommand: true,
		prompt: '/review main',
		error: undefined,
	});
});

test('parseReviewCliArgs: filters --provider flag and value', t => {
	t.deepEqual(parseReviewCliArgs(['review', 'main', '--provider', 'openrouter']), {
		isReviewCommand: true,
		prompt: '/review main',
		error: undefined,
	});
});

test('parseReviewCliArgs: filters --model flag and value', t => {
	t.deepEqual(parseReviewCliArgs(['review', 'main', '--model', 'gpt-4']), {
		isReviewCommand: true,
		prompt: '/review main',
		error: undefined,
	});
});

test('parseReviewCliArgs: filters --mode two-token', t => {
	t.deepEqual(parseReviewCliArgs(['review', 'main', '--mode', 'plan']), {
		isReviewCommand: true,
		prompt: '/review main',
		error: undefined,
	});
});

test('parseReviewCliArgs: filters --mode fused form', t => {
	t.deepEqual(parseReviewCliArgs(['review', 'main', '--mode=plan']), {
		isReviewCommand: true,
		prompt: '/review main',
		error: undefined,
	});
});

test('parseReviewCliArgs: filters --json flag', t => {
	t.deepEqual(parseReviewCliArgs(['review', 'main', '--json']), {
		isReviewCommand: true,
		prompt: '/review main',
		error: undefined,
	});
});

test('parseReviewCliArgs: filters --output-format flag and value', t => {
	t.deepEqual(parseReviewCliArgs(['review', 'main', '--output-format', 'json']), {
		isReviewCommand: true,
		prompt: '/review main',
		error: undefined,
	});
});

test('parseReviewCliArgs: filters --output-format fused form', t => {
	t.deepEqual(parseReviewCliArgs(['review', 'main', '--output-format=json']), {
		isReviewCommand: true,
		prompt: '/review main',
		error: undefined,
	});
});

test('parseReviewCliArgs: filters --context-max flag and value', t => {
	t.deepEqual(parseReviewCliArgs(['review', 'main', '--context-max', '128k']), {
		isReviewCommand: true,
		prompt: '/review main',
		error: undefined,
	});
});

test('parseReviewCliArgs: filters --vscode-port flag and value', t => {
	t.deepEqual(parseReviewCliArgs(['review', 'main', '--vscode-port', '3000']), {
		isReviewCommand: true,
		prompt: '/review main',
		error: undefined,
	});
});

test('parseReviewCliArgs: filters --plain and --no-plain', t => {
	t.deepEqual(parseReviewCliArgs(['review', 'main', '--plain']), {
		isReviewCommand: true,
		prompt: '/review main',
		error: undefined,
	});
	t.deepEqual(parseReviewCliArgs(['review', 'main', '--no-plain']), {
		isReviewCommand: true,
		prompt: '/review main',
		error: undefined,
	});
});

test('parseReviewCliArgs: filters --no-alt-screen and --alt-screen', t => {
	t.deepEqual(parseReviewCliArgs(['review', 'main', '--no-alt-screen']), {
		isReviewCommand: true,
		prompt: '/review main',
		error: undefined,
	});
	t.deepEqual(parseReviewCliArgs(['review', 'main', '--alt-screen']), {
		isReviewCommand: true,
		prompt: '/review main',
		error: undefined,
	});
});

test('parseReviewCliArgs: filters --trust-directory flag', t => {
	t.deepEqual(parseReviewCliArgs(['review', 'main', '--trust-directory']), {
		isReviewCommand: true,
		prompt: '/review main',
		error: undefined,
	});
});

test('parseReviewCliArgs: handles multiple mixed flags', t => {
	t.deepEqual(parseReviewCliArgs(['review', 'feature', '--provider', 'ollama', '--mode', 'plan', '--json']), {
		isReviewCommand: true,
		prompt: '/review feature',
		error: undefined,
	});
});

test('parseReviewCliArgs: flags between target and extra positionals still error', t => {
	const result = parseReviewCliArgs(['review', 'main', '--provider', 'ollama', 'extra']);
	t.is(result.isReviewCommand, true);
	t.is(result.prompt, undefined);
	t.truthy(result.error);
	t.true(result.error!.includes('extra'));
});
