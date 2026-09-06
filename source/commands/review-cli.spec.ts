import test from 'ava';
import {parseReviewCliArgs} from './review-cli';

test('parseReviewCliArgs: returns false for non-review commands', t => {
	t.deepEqual(parseReviewCliArgs(['run', 'hello']), {
		isReviewCommand: false,
		prompt: undefined,
	});
	t.deepEqual(parseReviewCliArgs([]), {
		isReviewCommand: false,
		prompt: undefined,
	});
});

test('parseReviewCliArgs: anchors on args[0]', t => {
	t.deepEqual(parseReviewCliArgs(['--vscode', 'review', 'main']), {
		isReviewCommand: false,
		prompt: undefined,
	});
});

test('parseReviewCliArgs: no args produces /review', t => {
	t.deepEqual(parseReviewCliArgs(['review']), {
		isReviewCommand: true,
		prompt: '/review',
	});
});

test('parseReviewCliArgs: branch name', t => {
	t.deepEqual(parseReviewCliArgs(['review', 'feature/auth']), {
		isReviewCommand: true,
		prompt: '/review feature/auth',
	});
});

test('parseReviewCliArgs: PR number', t => {
	t.deepEqual(parseReviewCliArgs(['review', '42']), {
		isReviewCommand: true,
		prompt: '/review 42',
	});
});

test('parseReviewCliArgs: only uses first positional arg', t => {
	t.deepEqual(parseReviewCliArgs(['review', 'feature', 'extra', 'args']), {
		isReviewCommand: true,
		prompt: '/review feature',
	});
});

test('parseReviewCliArgs: filters --vscode flag', t => {
	t.deepEqual(parseReviewCliArgs(['review', 'main', '--vscode']), {
		isReviewCommand: true,
		prompt: '/review main',
	});
});

test('parseReviewCliArgs: filters --provider flag and value', t => {
	t.deepEqual(parseReviewCliArgs(['review', 'main', '--provider', 'openrouter']), {
		isReviewCommand: true,
		prompt: '/review main',
	});
});

test('parseReviewCliArgs: filters --model flag and value', t => {
	t.deepEqual(parseReviewCliArgs(['review', 'main', '--model', 'gpt-4']), {
		isReviewCommand: true,
		prompt: '/review main',
	});
});

test('parseReviewCliArgs: filters --mode two-token', t => {
	t.deepEqual(parseReviewCliArgs(['review', 'main', '--mode', 'plan']), {
		isReviewCommand: true,
		prompt: '/review main',
	});
});

test('parseReviewCliArgs: filters --mode fused form', t => {
	t.deepEqual(parseReviewCliArgs(['review', 'main', '--mode=plan']), {
		isReviewCommand: true,
		prompt: '/review main',
	});
});

test('parseReviewCliArgs: filters --json flag', t => {
	t.deepEqual(parseReviewCliArgs(['review', 'main', '--json']), {
		isReviewCommand: true,
		prompt: '/review main',
	});
});

test('parseReviewCliArgs: filters --output-format flag and value', t => {
	t.deepEqual(parseReviewCliArgs(['review', 'main', '--output-format', 'json']), {
		isReviewCommand: true,
		prompt: '/review main',
	});
});

test('parseReviewCliArgs: filters --context-max flag and value', t => {
	t.deepEqual(parseReviewCliArgs(['review', 'main', '--context-max', '128k']), {
		isReviewCommand: true,
		prompt: '/review main',
	});
});

test('parseReviewCliArgs: filters --plain and --no-plain', t => {
	t.deepEqual(parseReviewCliArgs(['review', 'main', '--plain']), {
		isReviewCommand: true,
		prompt: '/review main',
	});
	t.deepEqual(parseReviewCliArgs(['review', 'main', '--no-plain']), {
		isReviewCommand: true,
		prompt: '/review main',
	});
});

test('parseReviewCliArgs: filters --no-alt-screen and --alt-screen', t => {
	t.deepEqual(parseReviewCliArgs(['review', 'main', '--no-alt-screen']), {
		isReviewCommand: true,
		prompt: '/review main',
	});
	t.deepEqual(parseReviewCliArgs(['review', 'main', '--alt-screen']), {
		isReviewCommand: true,
		prompt: '/review main',
	});
});

test('parseReviewCliArgs: filters --trust-directory flag', t => {
	t.deepEqual(parseReviewCliArgs(['review', 'main', '--trust-directory']), {
		isReviewCommand: true,
		prompt: '/review main',
	});
});

test('parseReviewCliArgs: handles multiple mixed flags', t => {
	t.deepEqual(parseReviewCliArgs(['review', 'feature', '--provider', 'ollama', '--mode', 'plan', '--json']), {
		isReviewCommand: true,
		prompt: '/review feature',
	});
});

test('parseReviewCliArgs: filters --output-format fused form', t => {
	t.deepEqual(parseReviewCliArgs(['review', 'main', '--output-format=json']), {
		isReviewCommand: true,
		prompt: '/review main',
	});
});

test('parseReviewCliArgs: filters --vscode-port flag and value', t => {
	t.deepEqual(parseReviewCliArgs(['review', 'main', '--vscode-port', '3000']), {
		isReviewCommand: true,
		prompt: '/review main',
	});
});
