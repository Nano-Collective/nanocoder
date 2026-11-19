import test from 'ava';
import {
	filterToolNamesByAccess,
	findUnmatchedToolPatterns,
	formatToolAccessSummary,
	getRunToolAccess,
	hasRunToolAccess,
	matchesAnyToolPattern,
	matchesToolPattern,
	parseToolAccessArgs,
	resetRunToolAccess,
	setRunToolAccess,
	validateRunToolAccess,
} from '@/tools/tool-access';

console.log(`\ntool-access.spec.ts`);

const KNOWN = ['read_file', 'write_file', 'execute_bash', 'search_files', 'mcp_fs_read'];

test.afterEach(() => {
	resetRunToolAccess();
});

test.serial('matchesToolPattern - exact names match only themselves', t => {
	t.true(matchesToolPattern('read_file', 'read_file'));
	t.false(matchesToolPattern('read_file', 'read'));
	t.false(matchesToolPattern('read_file', 'write_file'));
});

test.serial('matchesToolPattern - * is a wildcard over any run of characters', t => {
	t.true(matchesToolPattern('search_files', 'search_*'));
	t.true(matchesToolPattern('mcp_fs_read', 'mcp_*'));
	t.true(matchesToolPattern('read_file', '*'));
	t.true(matchesToolPattern('anything', '*'));
	t.false(matchesToolPattern('write_file', 'search_*'));
	t.false(matchesToolPattern('mcp_fs_read', 'mcp__*'));
});

test.serial('matchesToolPattern - wildcard anchors at both ends', t => {
	t.true(matchesToolPattern('a_b_c', 'a_*_c'));
	t.false(matchesToolPattern('x_a_b_c', 'a_*_c'));
	t.false(matchesToolPattern('a_b_c_x', 'a_*_c'));
});

test.serial('matchesToolPattern - regex metacharacters in a name are literal', t => {
	t.true(matchesToolPattern('a+b(c)', 'a+b(c)'));
	t.false(matchesToolPattern('aab(c)', 'a+b(c)'));
});

test.serial('matchesAnyToolPattern - any pattern may match', t => {
	t.true(matchesAnyToolPattern('read_file', ['write_file', 'read_file']));
	t.false(matchesAnyToolPattern('read_file', ['write_file', 'search_*']));
	t.false(matchesAnyToolPattern('read_file', []));
});

test.serial('filterToolNamesByAccess - allow list keeps only matches', t => {
	const result = filterToolNamesByAccess(KNOWN, {
		allowed: ['read_file', 'search_*'],
		disallowed: [],
	});
	t.deepEqual(result, ['read_file', 'search_files']);
});

test.serial('filterToolNamesByAccess - deny list removes matches', t => {
	const result = filterToolNamesByAccess(KNOWN, {
		allowed: [],
		disallowed: ['execute_bash', 'mcp_*'],
	});
	t.deepEqual(result, ['read_file', 'write_file', 'search_files']);
});

test.serial('filterToolNamesByAccess - deny wins over allow', t => {
	const result = filterToolNamesByAccess(KNOWN, {
		allowed: ['read_file', 'write_file'],
		disallowed: ['write_file'],
	});
	t.deepEqual(result, ['read_file']);
});

test.serial('filterToolNamesByAccess - no filter returns a copy', t => {
	const result = filterToolNamesByAccess(KNOWN, undefined);
	t.deepEqual(result, KNOWN);
	t.not(result, KNOWN);
});

test.serial('findUnmatchedToolPatterns - reports every pattern matching nothing', t => {
	t.deepEqual(findUnmatchedToolPatterns(['read_file', 'search_*', 'nope'], KNOWN), [
		'nope',
	]);
	t.deepEqual(findUnmatchedToolPatterns(['*'], KNOWN), []);
});

test.serial('run filter state - set, read and reset', t => {
	t.false(hasRunToolAccess());
	setRunToolAccess({allowed: ['read_file'], disallowed: ['write_file']});
	t.true(hasRunToolAccess());
	t.deepEqual(getRunToolAccess(), {
		allowed: ['read_file'],
		disallowed: ['write_file'],
	});
	resetRunToolAccess();
	t.false(hasRunToolAccess());
	t.is(getRunToolAccess(), undefined);
});

test.serial('run filter state - empty lists clear the filter', t => {
	setRunToolAccess({allowed: ['read_file'], disallowed: []});
	setRunToolAccess({allowed: [], disallowed: []});
	t.false(hasRunToolAccess());
});

test.serial('run filter state - the stored lists are copied', t => {
	const allowed = ['read_file'];
	const disallowed = ['write_file'];
	setRunToolAccess({allowed, disallowed});
	allowed.push('execute_bash');
	disallowed.length = 0;
	t.deepEqual(getRunToolAccess(), {
		allowed: ['read_file'],
		disallowed: ['write_file'],
	});
});

test.serial('validateRunToolAccess - no filter is always valid', t => {
	t.is(validateRunToolAccess(KNOWN), undefined);
});

test.serial('validateRunToolAccess - names an unknown allow pattern and the valid tools', t => {
	setRunToolAccess({allowed: ['reed_file'], disallowed: []});
	const message = validateRunToolAccess(KNOWN);
	t.truthy(message);
	t.true(message?.includes('--allowed-tools'));
	t.true(message?.includes('"reed_file"'));
	t.true(message?.includes('read_file'));
	t.true(message?.includes('execute_bash'));
});

test.serial('validateRunToolAccess - names an unknown deny pattern', t => {
	setRunToolAccess({allowed: [], disallowed: ['execute_bashh']});
	const message = validateRunToolAccess(KNOWN);
	t.truthy(message);
	t.true(message?.includes('--disallowed-tools'));
	t.true(message?.includes('"execute_bashh"'));
});

test.serial('validateRunToolAccess - reports both flags in one message', t => {
	setRunToolAccess({allowed: ['nope'], disallowed: ['also_nope']});
	const message = validateRunToolAccess(KNOWN);
	t.truthy(message);
	t.true(message?.includes('--allowed-tools'));
	t.true(message?.includes('--disallowed-tools'));
});

test.serial('validateRunToolAccess - globs that match a known tool are valid', t => {
	setRunToolAccess({allowed: ['search_*', 'mcp_*'], disallowed: ['execute_*']});
	t.is(validateRunToolAccess(KNOWN), undefined);
});

test.serial('parseToolAccessArgs - spaced form, comma separated', t => {
	t.deepEqual(
		parseToolAccessArgs(['--allowed-tools', 'read_file,search_*', 'run', 'hi']),
		{allowed: ['read_file', 'search_*'], disallowed: []},
	);
	t.deepEqual(parseToolAccessArgs(['--disallowed-tools', 'execute_bash']), {
		allowed: [],
		disallowed: ['execute_bash'],
	});
});

test.serial('parseToolAccessArgs - fused form', t => {
	t.deepEqual(parseToolAccessArgs(['--allowed-tools=read_file,search_*']), {
		allowed: ['read_file', 'search_*'],
		disallowed: [],
	});
	t.deepEqual(parseToolAccessArgs(['--disallowed-tools=execute_bash']), {
		allowed: [],
		disallowed: ['execute_bash'],
	});
});

test.serial('parseToolAccessArgs - repeated flags accumulate and dedupe', t => {
	t.deepEqual(
		parseToolAccessArgs([
			'--allowed-tools',
			'read_file',
			'--allowed-tools=search_*,read_file',
		]),
		{allowed: ['read_file', 'search_*'], disallowed: []},
	);
});

test.serial('parseToolAccessArgs - trims whitespace and drops empty entries', t => {
	t.deepEqual(parseToolAccessArgs(['--allowed-tools', ' read_file , , search_* ']), {
		allowed: ['read_file', 'search_*'],
		disallowed: [],
	});
});

test.serial('parseToolAccessArgs - ignores unrelated arguments', t => {
	t.deepEqual(
		parseToolAccessArgs([
			'--provider',
			'ollama',
			'--allowed-tools',
			'read_file',
			'run',
			'do the thing',
		]),
		{allowed: ['read_file'], disallowed: []},
	);
});

test.serial('parseToolAccessArgs - a missing value is an error', t => {
	for (const args of [
		['--allowed-tools'],
		['--disallowed-tools'],
		['--allowed-tools', '--json'],
	]) {
		const result = parseToolAccessArgs(args);
		t.true('error' in result);
		if ('error' in result) {
			t.true(result.error.includes('requires a value'));
		}
	}
});

test.serial('parseToolAccessArgs - an empty value is an error', t => {
	for (const args of [['--allowed-tools='], ['--allowed-tools', ' , ']]) {
		const result = parseToolAccessArgs(args);
		t.true('error' in result);
		if ('error' in result) {
			t.true(result.error.includes('at least one tool name'));
		}
	}
});

test.serial('formatToolAccessSummary - describes allow, deny and both', t => {
	t.is(
		formatToolAccessSummary({allowed: ['read_file', 'search_*'], disallowed: []}),
		'only read_file, search_*',
	);
	t.is(
		formatToolAccessSummary({allowed: [], disallowed: ['execute_bash']}),
		'all except execute_bash',
	);
	t.is(
		formatToolAccessSummary({
			allowed: ['read_file'],
			disallowed: ['execute_bash'],
		}),
		'only read_file (blocked: execute_bash)',
	);
});
