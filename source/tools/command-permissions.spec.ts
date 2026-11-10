import test from 'ava';
import {
	evaluatePermissionRules,
	matchesCommandPattern,
	parsePermissionRule,
	splitSimpleCommands,
} from './command-permissions.js';

// ============================================================================
// parsePermissionRule
// ============================================================================

test('parsePermissionRule accepts a bare tool name', t => {
	t.deepEqual(parsePermissionRule('execute_bash'), {tool: 'execute_bash'});
	t.deepEqual(parsePermissionRule('  read_file  '), {tool: 'read_file'});
});

test('parsePermissionRule accepts a tool with a command pattern', t => {
	t.deepEqual(parsePermissionRule('execute_bash(git status)'), {
		tool: 'execute_bash',
		pattern: 'git status',
	});
	t.deepEqual(parsePermissionRule('execute_bash( git diff * )'), {
		tool: 'execute_bash',
		pattern: 'git diff *',
	});
});

test('parsePermissionRule rejects malformed rules', t => {
	t.is(parsePermissionRule(''), null);
	t.is(parsePermissionRule('   '), null);
	t.is(parsePermissionRule('execute_bash('), null);
	t.is(parsePermissionRule('execute_bash(git status'), null);
	t.is(parsePermissionRule('(git status)'), null);
	t.is(parsePermissionRule('execute_bash()'), null);
	t.is(parsePermissionRule('execute_bash)'), null);
});

// ============================================================================
// matchesCommandPattern
// ============================================================================

test('matchesCommandPattern anchors to the whole command', t => {
	t.true(matchesCommandPattern('git status', 'git status'));
	t.false(matchesCommandPattern('git status', 'git status --short'));
	t.false(matchesCommandPattern('status', 'git status'));
});

test('matchesCommandPattern treats * as any run of characters', t => {
	t.true(matchesCommandPattern('git *', 'git status'));
	t.true(matchesCommandPattern('git *', 'git diff --cached'));
	t.true(matchesCommandPattern('*--force*', 'git push --force origin'));
	t.false(matchesCommandPattern('git *', 'npm test'));
});

test('matchesCommandPattern treats regex metacharacters literally', t => {
	t.true(matchesCommandPattern('git log --grep=a.b', 'git log --grep=a.b'));
	t.false(matchesCommandPattern('git log --grep=a.b', 'git log --grep=axb'));
	t.true(
		matchesCommandPattern('echo (a+b)', 'echo (a+b)'),
	);
});

// ============================================================================
// splitSimpleCommands
// ============================================================================

test('splitSimpleCommands splits on separators', t => {
	t.deepEqual(splitSimpleCommands('git status && npm test'), [
		'git status',
		'npm test',
	]);
	t.deepEqual(splitSimpleCommands('a; b\nc || d | e'), ['a', 'b', 'c', 'd', 'e']);
});

test('splitSimpleCommands respects quotes and escapes', t => {
	t.deepEqual(splitSimpleCommands('echo "a && b"'), ['echo "a && b"']);
	t.deepEqual(splitSimpleCommands("echo 'a; b'"), ["echo 'a; b'"]);
	t.deepEqual(splitSimpleCommands('echo a\\;b'), ['echo a\\;b']);
});

test('splitSimpleCommands joins backslash-newline continuations', t => {
	t.deepEqual(splitSimpleCommands('git status \\\n --short'), [
		'git status  --short',
	]);
	t.deepEqual(splitSimpleCommands('git sta\\\ntus'), ['git status']);
});

test('splitSimpleCommands refuses constructs that can hide a command', t => {
	for (const command of [
		'echo `whoami`',
		'echo $(whoami)',
		'cat <(whoami)',
		'echo hi > file',
		'{ echo a; echo b; }',
		'(echo a)',
		'sleep 1 & echo done',
	]) {
		t.is(splitSimpleCommands(command), null, command);
	}
});

test('splitSimpleCommands refuses an unterminated quote and empty input', t => {
	t.is(splitSimpleCommands('echo "unterminated'), null);
	t.is(splitSimpleCommands("echo 'unterminated"), null);
	t.is(splitSimpleCommands('   '), null);
});

// ============================================================================
// evaluatePermissionRules — allow
// ============================================================================

test('an allow rule covers a matching command', t => {
	t.true(
		evaluatePermissionRules('execute_bash', 'git status', {
			allow: ['execute_bash(git status)'],
		}).allowed,
	);
});

test('an allow rule does not cover a different command', t => {
	t.false(
		evaluatePermissionRules('execute_bash', 'rm -rf /', {
			allow: ['execute_bash(git status)'],
		}).allowed,
	);
});

test('allow must cover every simple command in the line', t => {
	const permissions = {allow: ['execute_bash(git status)']};
	t.false(
		evaluatePermissionRules('execute_bash', 'git status && rm -rf x', permissions)
			.allowed,
	);
	t.true(
		evaluatePermissionRules(
			'execute_bash',
			'git status && git status',
			permissions,
		).allowed,
	);
});

test('allow stays inert when the command cannot be split safely', t => {
	t.false(
		evaluatePermissionRules('execute_bash', 'git status && echo $(whoami)', {
			allow: ['execute_bash(git *)'],
		}).allowed,
	);
});

test('a bare tool allow rule covers any command', t => {
	t.true(
		evaluatePermissionRules('execute_bash', 'anything --at-all', {
			allow: ['execute_bash'],
		}).allowed,
	);
});

test('a bare allow rule applies to non-command tools', t => {
	t.true(
		evaluatePermissionRules('write_file', undefined, {
			allow: ['write_file'],
		}).allowed,
	);
});

test('a pattern allow rule is inert for a tool with no command', t => {
	t.false(
		evaluatePermissionRules('write_file', undefined, {
			allow: ['write_file(*)'],
		}).allowed,
	);
});

// ============================================================================
// evaluatePermissionRules — deny
// ============================================================================

test('a deny rule matches the whole line and any simple command', t => {
	const permissions = {deny: ['execute_bash(rm *)']};
	t.true(
		evaluatePermissionRules('execute_bash', 'rm -rf /', permissions).deniedReason !==
			undefined,
	);
	t.true(
		evaluatePermissionRules('execute_bash', 'git status && rm -rf /', permissions)
			.deniedReason !== undefined,
	);
	t.true(
		evaluatePermissionRules('execute_bash', 'rm -rf / || echo ok', permissions)
			.deniedReason !== undefined,
	);
});

test('a deny pattern can match across separators', t => {
	t.true(
		evaluatePermissionRules('execute_bash', 'git push origin main --force', {
			deny: ['execute_bash(*--force*)'],
		}).deniedReason !== undefined,
	);
});

test('a bare deny rule refuses every call to the tool', t => {
	t.true(
		evaluatePermissionRules('execute_bash', 'git status', {
			deny: ['execute_bash'],
		}).deniedReason !== undefined,
	);
});

test('deny wins over allow', t => {
	const decision = evaluatePermissionRules('execute_bash', 'rm -rf /', {
		allow: ['execute_bash(*)'],
		deny: ['execute_bash(rm *)'],
	});
	t.false(decision.allowed);
	t.true(decision.deniedReason?.includes('nanocoder.permissions.deny'));
});

test('a deny reason quotes the matched rule', t => {
	const decision = evaluatePermissionRules('execute_bash', 'rm -rf /', {
		deny: ['execute_bash(rm *)'],
	});
	t.true(decision.deniedReason?.includes('execute_bash(rm *)'));
});
