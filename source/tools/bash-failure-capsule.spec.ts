import {mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'ava';
import {TRUNCATION_OUTPUT_LIMIT} from '@/constants';
import type {BashExecutionState} from '@/services/bash-executor';
import {
	buildFailureCapsule,
	buildNarrowCommand,
	type FailureReport,
	formatFailureCapsule,
	parseFailureReport,
} from './bash-failure-capsule';

// Fixtures are real output from each runner, captured from a failing suite
// with output piped (no TTY), the way execute_bash runs them.

const JEST_OUTPUT = `FAIL jest/auth.test.js
  ● refreshSession › retries once on 401

    expect(received).toBe(expected) // Object.is equality

    Expected: 2
    Received: 1

       5 |   test("retries once on 401", () => {
       6 |     const calls = [401];
    >  7 |     expect(refreshSession(calls)).toBe(2);
         |                                   ^
       8 |   });
       9 | });
      10 |

      at Object.toBe (jest/auth.test.js:7:35)

FAIL jest/profile.test.js
  ● profile › renders the display name

    expect(received).toEqual(expected) // deep equality

    - Expected  - 1
    + Received  + 1

      Object {
    -   "name": "Ada Lovelace",
    +   "name": "Ada",
        "role": "admin",
      }

      2 | describe("profile", () => {
      3 |   test("renders the display name", () => {
    > 4 |     expect({name: "Ada", role: "admin"}).toEqual({name: "Ada Lovelace", role: "admin"});
        |                                          ^
      5 |   });
      6 | });
      7 |

      at Object.toEqual (jest/profile.test.js:4:42)

PASS jest/math.test.js

Test Suites: 2 failed, 1 passed, 3 total
Tests:       2 failed, 41 passed, 43 total
Snapshots:   0 total
Time:        0.441 s
Ran all test suites matching /jest\\//i.`;

const VITEST_OUTPUT = `
 RUN  v3.2.7 /private/tmp/nc-1584-runners

 ✓ vitest/format.test.js (40 tests) 2ms
 ❯ vitest/cart.test.js (1 test | 1 failed) 4ms
   × cart > applies the discount 3ms
     → expected 90 to be 85 // Object.is equality

 Test Files  1 failed | 1 passed (2)
      Tests  1 failed | 40 passed (41)
   Start at  14:54:37
   Duration  226ms (transform 16ms, setup 0ms, collect 15ms, tests 6ms, environment 0ms, prepare 93ms)

⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯

 FAIL  vitest/cart.test.js > cart > applies the discount
AssertionError: expected 90 to be 85 // Object.is equality

- Expected
+ Received

- 85
+ 90

 ❯ vitest/cart.test.js:5:19
      3|   test("applies the discount", () => {
      4|     const total = 100 * 0.9;
      5|     expect(total).toBe(85);
       |                   ^
      6|   });
      7| });

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/1]⎯
`;

const MOCHA_OUTPUT = `

  parser
    1) parses a header line

  utils
    ✔ slugifies case 0
    ✔ slugifies case 1


  2 passing (5ms)
  1 failing

  1) parser
       parses a header line:

      AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:

'Header' !== 'header'

      + expected - actual

      -Header
      +header
      
      at Context.<anonymous> (mocha/parser.spec.js:4:12)
      at process.processImmediate (node:internal/timers:504:21)



npm warn Unknown env config "devdir". This will stop working in the next major version of npm.`;

// The error is thrown in the code under test, so the first project frame is
// the source file and the test file only appears one frame down.
const MOCHA_SOURCE_FRAME_OUTPUT = `

  parser
    ✔ parses a line
    1) rejects empty input


  1 passing (2ms)
  1 failing

  1) parser
       rejects empty input:
     TypeError: Cannot read properties of undefined (reading 'length')
      at parse (mocha2/src/parser.js:3:16)
      at Context.<anonymous> (mocha2/test/parser.test.js:6:24)
      at process.processImmediate (node:internal/timers:504:21)



`;

const AVA_OUTPUT = `  ✔ config › index › loads the project config
  ✘ [fail]: source › config › index › getClosestConfigFile prefers cwd config over home config Should prefer cwd config
  ─

  source › config › index › getClosestConfigFile prefers cwd config over home config

  source/config/index.spec.ts:49

   48:     const configPath = getClosestConfigFile(fileName);
   49:     t.is(configPath, cwdConfig, 'Should prefer cwd config');
   50:     t.is(confDirMap[fileName], cwdConfig, 'Should store cwd path in map'…

  Should prefer cwd config

  Difference (- actual, + expected):

  - '/tmp/demo/config/test-priority.json'
  + '/repo/test-priority.json'

  › <anonymous> (source/config/index.spec.ts:49:5)

  ─

  1 test failed`;

const TSC_OUTPUT = `ts/user.ts(2,29): error TS2322: Type 'string' is not assignable to type 'number'.
ts/user.ts(3,42): error TS2322: Type 'string' is not assignable to type 'number'.`;

const CWD = '/tmp/project';

function bashState(
	overrides: Partial<BashExecutionState> = {},
): BashExecutionState {
	return {
		executionId: 'test',
		command: 'npx jest jest/',
		outputPreview: '',
		fullOutput: '',
		stderr: JEST_OUTPUT,
		isComplete: true,
		exitCode: 1,
		error: null,
		...overrides,
	};
}

function reportFor(output: string): FailureReport {
	const report = parseFailureReport(output, CWD);
	if (!report) throw new Error('expected a failure report');
	return report;
}

// --- parsing ------------------------------------------------------------------

test('parseFailureReport keeps each Jest failure with its assertion and location', t => {
	const report = reportFor(JEST_OUTPUT);

	t.is(report.runner, 'jest');
	t.is(report.summary, 'Tests: 2 failed, 41 passed, 43 total');
	t.deepEqual(report.failures[0], {
		title: 'refreshSession › retries once on 401',
		file: 'jest/auth.test.js',
		location: 'jest/auth.test.js:7:35',
		nameFilter: 'refreshSession retries once on 401',
		diagnostic: [
			'expect(received).toBe(expected) // Object.is equality',
			'Expected: 2',
			'Received: 1',
		],
	});
	t.is(report.failures[1]?.title, 'profile › renders the display name');
	t.true(report.failures[1]?.diagnostic.includes('+   "name": "Ada",'));
	// Code frames and stack lines are dropped.
	t.false(report.failures.some(f => f.diagnostic.some(l => l.includes('|'))));
});

test('parseFailureReport reads Vitest failures from the Failed Tests section', t => {
	const report = reportFor(VITEST_OUTPUT);

	t.is(report.runner, 'vitest');
	t.is(report.summary, 'Tests 1 failed | 40 passed (41)');
	t.deepEqual(report.failures, [
		{
			title: 'cart > applies the discount',
			file: 'vitest/cart.test.js',
			location: 'vitest/cart.test.js:5:19',
			nameFilter: 'cart applies the discount',
			diagnostic: [
				'AssertionError: expected 90 to be 85 // Object.is equality',
				'- Expected',
				'+ Received',
				'- 85',
				'+ 90',
			],
		},
	]);
});

test('parseFailureReport reads Mocha failures and stops at the end of the stack', t => {
	const report = reportFor(MOCHA_OUTPUT);

	t.is(report.runner, 'mocha');
	t.is(report.summary, '2 passing (5ms), 1 failing');
	t.deepEqual(report.failures, [
		{
			title: 'parser parses a header line',
			file: 'mocha/parser.spec.js',
			location: 'mocha/parser.spec.js:4:12',
			nameFilter: 'parser parses a header line',
			diagnostic: [
				'AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:',
				"'Header' !== 'header'",
				'+ expected - actual',
				'-Header',
				'+header',
			],
		},
	]);
});

test('parseFailureReport takes the Mocha test file from the stack, not the code under test', t => {
	const report = reportFor(MOCHA_SOURCE_FRAME_OUTPUT);

	t.deepEqual(report.failures, [
		{
			title: 'parser rejects empty input',
			file: 'mocha2/test/parser.test.js',
			location: 'mocha2/src/parser.js:3:16',
			nameFilter: 'parser rejects empty input',
			diagnostic: [
				"TypeError: Cannot read properties of undefined (reading 'length')",
			],
		},
	]);
});

test('parseFailureReport leaves the Mocha file unset when no stack frame is a test file', t => {
	const report = reportFor(
		MOCHA_SOURCE_FRAME_OUTPUT.replace(
			'at Context.<anonymous> (mocha2/test/parser.test.js:6:24)',
			'at Context.<anonymous> (mocha2/src/runner.js:6:24)',
		),
	);

	t.is(report.failures[0]?.file, undefined);
	t.is(report.failures[0]?.location, 'mocha2/src/parser.js:3:16');
});

test('parseFailureReport normalises Windows paths to forward slashes', t => {
	const jest = reportFor(
		JEST_OUTPUT.replace('FAIL jest/auth.test.js', 'FAIL jest\\auth.test.js').replace(
			'(jest/auth.test.js:7:35)',
			'(jest\\auth.test.js:7:35)',
		),
	);
	t.is(jest.failures[0]?.file, 'jest/auth.test.js');
	t.is(jest.failures[0]?.location, 'jest/auth.test.js:7:35');

	const ava = reportFor(
		AVA_OUTPUT.replace(
			'  source/config/index.spec.ts:49',
			'  source\\config\\index.spec.ts:49',
		).replace(
			'(source/config/index.spec.ts:49:5)',
			'(.\\source\\config\\index.spec.ts:49:5)',
		),
	);
	t.is(ava.failures[0]?.file, 'source/config/index.spec.ts');
	t.is(ava.failures[0]?.location, 'source/config/index.spec.ts:49:5');
	t.is(
		ava.failures[0]?.nameFilter,
		'getClosestConfigFile prefers cwd config over home config',
	);
});

test('parseFailureReport reads AVA failure blocks and strips the file prefix from the title', t => {
	const report = reportFor(AVA_OUTPUT);

	t.is(report.runner, 'ava');
	t.is(report.summary, '1 test failed');
	t.deepEqual(report.failures, [
		{
			title:
				'source › config › index › getClosestConfigFile prefers cwd config over home config',
			file: 'source/config/index.spec.ts',
			location: 'source/config/index.spec.ts:49:5',
			nameFilter: 'getClosestConfigFile prefers cwd config over home config',
			diagnostic: [
				'Should prefer cwd config',
				'Difference (- actual, + expected):',
				"- '/tmp/demo/config/test-priority.json'",
				"+ '/repo/test-priority.json'",
			],
		},
	]);
});

test('parseFailureReport drops the AVA name filter when the title has a wildcard', t => {
	const report = reportFor(
		AVA_OUTPUT.replaceAll(
			'getClosestConfigFile prefers cwd config over home config',
			'matches *.json files',
		),
	);

	t.is(report.failures[0]?.nameFilter, undefined);
});

test('parseFailureReport keeps every TypeScript error, including repeats of one message', t => {
	const report = reportFor(TSC_OUTPUT);

	t.is(report.runner, 'tsc');
	t.is(report.summary, '2 TypeScript errors');
	t.deepEqual(
		report.failures.map(f => f.location),
		['ts/user.ts:2:29', 'ts/user.ts:3:42'],
	);
	t.is(
		report.failures[0]?.title,
		"TS2322 Type 'string' is not assignable to type 'number'.",
	);
});

test('parseFailureReport reads the pretty tsc format', t => {
	const report = reportFor(
		"src/a.ts:3:7 - error TS2322: Type 'string' is not assignable to type 'number'.\n\n3 const n: number = 'x';\n        ~\n\nFound 1 error in src/a.ts:3",
	);

	t.is(report.failures[0]?.location, 'src/a.ts:3:7');
	t.is(report.summary, 'Found 1 error in src/a.ts:3');
});

test('parseFailureReport ignores ANSI colours', t => {
	const coloured = JEST_OUTPUT.replace(
		'FAIL jest/auth.test.js',
		'\x1b[1m\x1b[31mFAIL\x1b[39m\x1b[22m jest/auth.test.js',
	).replace('Expected: 2', '\x1b[32mExpected: 2\x1b[39m');

	t.deepEqual(reportFor(coloured), reportFor(JEST_OUTPUT));
});

test('parseFailureReport makes absolute paths inside the working directory relative', t => {
	const report = reportFor(
		MOCHA_OUTPUT.replace(
			'(mocha/parser.spec.js:4:12)',
			`(${CWD}/mocha/parser.spec.js:4:12)`,
		),
	);

	t.is(report.failures[0]?.file, 'mocha/parser.spec.js');
});

test('parseFailureReport returns null for output it does not recognise', t => {
	t.is(
		parseFailureReport('make: *** [build] Error 2\nsomething went wrong', CWD),
		null,
	);
});

// --- narrow command -------------------------------------------------------------

test('buildNarrowCommand narrows a direct runner call to the first failing test', t => {
	const report = reportFor(JEST_OUTPUT);

	t.is(
		buildNarrowCommand('npx jest jest/', report, CWD),
		"npx jest jest/ jest/auth.test.js -t 'refreshSession retries once on 401'",
	);
	t.is(
		buildNarrowCommand('jest', report, CWD),
		"jest jest/auth.test.js -t 'refreshSession retries once on 401'",
	);
	t.is(
		buildNarrowCommand(
			'pnpm exec vitest run',
			reportFor(VITEST_OUTPUT),
			CWD,
		),
		"pnpm exec vitest run vitest/cart.test.js -t 'cart applies the discount'",
	);
	t.is(
		buildNarrowCommand('./node_modules/.bin/ava', reportFor(AVA_OUTPUT), CWD),
		"./node_modules/.bin/ava source/config/index.spec.ts --match 'getClosestConfigFile prefers cwd config over home config'",
	);
});

test('buildNarrowCommand escapes regex characters and quotes test names safely', t => {
	const report = reportFor(
		JEST_OUTPUT.replace(
			'● refreshSession › retries once on 401',
			"● it's (really) $HOME › costs $5.00",
		),
	);

	t.is(
		buildNarrowCommand('npx jest', report, CWD),
		"npx jest jest/auth.test.js -t 'it'\\''s \\(really\\) \\$HOME costs \\$5\\.00'",
	);
});

test('buildNarrowCommand narrows a package script whose body runs the runner', t => {
	const cwd = mkdtempSync(join(tmpdir(), 'nanocoder-capsule-'));
	try {
		writeFileSync(
			join(cwd, 'package.json'),
			JSON.stringify({
				scripts: {
					test: 'jest jest/',
					'test:unit': 'mocha "mocha/*.spec.js"',
					'test:chain': 'jest jest/ && echo done',
					lint: 'eslint .',
				},
			}),
		);
		const jest = reportFor(JEST_OUTPUT);

		t.is(
			buildNarrowCommand('npm test', jest, cwd),
			"npm test -- jest/auth.test.js -t 'refreshSession retries once on 401'",
		);
		t.is(
			buildNarrowCommand('npm test -- --ci', jest, cwd),
			"npm test -- --ci jest/auth.test.js -t 'refreshSession retries once on 401'",
		);
		t.is(
			buildNarrowCommand('pnpm test', jest, cwd),
			"pnpm test jest/auth.test.js -t 'refreshSession retries once on 401'",
		);
		t.is(
			buildNarrowCommand('yarn run test:unit', reportFor(MOCHA_OUTPUT), cwd),
			"yarn run test:unit mocha/parser.spec.js --grep 'parser parses a header line'",
		);
		// The script chains another command, so appended args would land on it.
		t.is(buildNarrowCommand('npm run test:chain', jest, cwd), null);
		t.is(buildNarrowCommand('pnpm lint', jest, cwd), null);
		t.is(buildNarrowCommand('npm run missing', jest, cwd), null);
	} finally {
		rmSync(cwd, {recursive: true, force: true});
	}
});

test('buildNarrowCommand leaves anything beyond a plain command alone', t => {
	const report = reportFor(JEST_OUTPUT);

	for (const command of [
		'npx jest | tee jest.log',
		'cd app && npx jest',
		'npx jest; echo done',
		'npx jest > out.txt',
		'npx jest $(cat files)',
		'npx jest "unbalanced',
	]) {
		t.is(buildNarrowCommand(command, report, CWD), null, command);
	}
});

test('buildNarrowCommand only narrows the runner that produced the output', t => {
	t.is(buildNarrowCommand('npx mocha', reportFor(JEST_OUTPUT), CWD), null);
	t.is(buildNarrowCommand('npx tsc -p ts', reportFor(TSC_OUTPUT), CWD), null);
});

test('buildNarrowCommand never narrows Mocha to the source file the error came from', t => {
	const report = reportFor(MOCHA_SOURCE_FRAME_OUTPUT);

	t.is(
		buildNarrowCommand('npx mocha mocha2/test/parser.test.js', report, CWD),
		"npx mocha mocha2/test/parser.test.js --grep 'parser rejects empty input'",
	);
	t.is(
		buildNarrowCommand('npx mocha', report, CWD),
		"npx mocha mocha2/test/parser.test.js --grep 'parser rejects empty input'",
	);

	const cwd = mkdtempSync(join(tmpdir(), 'nanocoder-capsule-'));
	try {
		writeFileSync(
			join(cwd, 'package.json'),
			JSON.stringify({scripts: {test: 'mocha "mocha2/test/*.test.js"'}}),
		);
		t.is(
			buildNarrowCommand('npm test', report, cwd),
			"npm test -- mocha2/test/parser.test.js --grep 'parser rejects empty input'",
		);
	} finally {
		rmSync(cwd, {recursive: true, force: true});
	}

	// No test-file frame at all: narrow by name only.
	const noTestFrame = reportFor(
		MOCHA_SOURCE_FRAME_OUTPUT.replace(
			'mocha2/test/parser.test.js:6:24',
			'mocha2/src/runner.js:6:24',
		),
	);
	t.is(
		buildNarrowCommand('npx mocha', noTestFrame, CWD),
		"npx mocha --grep 'parser rejects empty input'",
	);
});

test('buildNarrowCommand does not repeat a file the command already names', t => {
	t.is(
		buildNarrowCommand('npx jest jest/auth.test.js', reportFor(JEST_OUTPUT), CWD),
		"npx jest jest/auth.test.js -t 'refreshSession retries once on 401'",
	);
});

// --- capsule ------------------------------------------------------------------

function capsuleFor(
	rerun: BashExecutionState | null,
	output = JEST_OUTPUT,
): string {
	return formatFailureCapsule({
		result: bashState({stderr: output}),
		report: reportFor(output),
		narrowCommand:
			"npx jest jest/ jest/auth.test.js -t 'refreshSession retries once on 401'",
		rerun,
		originalLength: 5_000,
	});
}

test('formatFailureCapsule leads with the reproduce command and lists each failure', t => {
	const capsule = capsuleFor(bashState({exitCode: 1}));

	t.is(
		capsule,
		[
			'EXIT_CODE: 1',
			'FAILURE CAPSULE (jest): 2 failing. Distilled from 5000 characters of output; only the failures are kept.',
			"Reproduce: npx jest jest/ jest/auth.test.js -t 'refreshSession retries once on 401'",
			'Re-ran it on its own: still fails (exit 1).',
			'',
			'1) refreshSession › retries once on 401',
			'   at jest/auth.test.js:7:35',
			'   expect(received).toBe(expected) // Object.is equality',
			'   Expected: 2',
			'   Received: 1',
			'',
			'2) profile › renders the display name',
			'   at jest/profile.test.js:4:42',
			'   expect(received).toEqual(expected) // deep equality',
			'   - Expected  - 1',
			'   + Received  + 1',
			'   Object {',
			'   -   "name": "Ada Lovelace",',
			'   +   "name": "Ada",',
			'   "role": "admin",',
			'   }',
			'Summary: Tests: 2 failed, 41 passed, 43 total',
		].join('\n'),
	);
});

test('formatFailureCapsule only says "still fails" when the re-run reports a failing test', t => {
	const rerunLine = (rerun: BashExecutionState) =>
		capsuleFor(rerun)
			.split('\n')
			.find(line => line.startsWith('Re-ran'));

	t.is(
		rerunLine(bashState({exitCode: 1})),
		'Re-ran it on its own: still fails (exit 1).',
	);
	// AVA exits 1 when --match finds nothing.
	t.is(
		rerunLine(
			bashState({
				exitCode: 1,
				stderr: "  ✘ Couldn't find any matching tests",
			}),
		),
		'Re-ran it on its own: exited 1 without reporting a failing test, so the result is inconclusive.',
	);
});

test('formatFailureCapsule only says "passed" when the re-run ran a test', t => {
	const rerunLine = (stderr: string, output = JEST_OUTPUT) =>
		capsuleFor(bashState({exitCode: 0, stderr}), output)
			.split('\n')
			.find(line => line.startsWith('Re-ran'));
	const flaky =
		'Re-ran it on its own: it passed, so the failure depends on other tests or is flaky.';
	const noTests =
		'Re-ran it on its own: no tests ran, so the result is inconclusive.';

	// Real summaries of narrow re-runs: one that ran the test, and filters
	// that matched nothing (each exits 0).
	t.is(rerunLine('Tests:       39 skipped, 1 passed, 40 total'), flaky);
	t.is(rerunLine('Tests:       83 skipped, 83 total'), noTests);
	t.is(
		rerunLine('      Tests  1 passed | 39 skipped (40)', VITEST_OUTPUT),
		flaky,
	);
	t.is(rerunLine('      Tests  1 skipped (1)', VITEST_OUTPUT), noTests);
	t.is(rerunLine('  1 passing (2ms)', MOCHA_OUTPUT), flaky);
	t.is(rerunLine('  0 passing (1ms)', MOCHA_OUTPUT), noTests);
	t.is(rerunLine('  1 test passed', AVA_OUTPUT), flaky);
});

test('formatFailureCapsule reports a narrow re-run that could not finish or was skipped', t => {
	t.true(
		capsuleFor(bashState({exitCode: null, error: 'Command timed out'})).includes(
			'Re-ran it on its own: could not finish (Command timed out).',
		),
	);
	t.false(capsuleFor(null).includes('Re-ran'));
});

test('formatFailureCapsule names the test file when the error came from the code under test', t => {
	const capsule = formatFailureCapsule({
		result: bashState({command: 'npx mocha', stderr: MOCHA_SOURCE_FRAME_OUTPUT}),
		report: reportFor(MOCHA_SOURCE_FRAME_OUTPUT),
		narrowCommand: null,
		originalLength: 5_000,
	});

	t.true(
		capsule.includes(
			'1) parser rejects empty input\n   at mocha2/src/parser.js:3:16\n   in mocha2/test/parser.test.js\n',
		),
		capsule,
	);
});

test('formatFailureCapsule stays within the bash output limit and counts what it left out', t => {
	const many = Array.from(
		{length: 40},
		(_, index) =>
			`FAIL jest/suite-${index}.test.js\n  ● suite ${index} › fails with a long assertion message number ${index}\n\n    ${'expected something quite specific but received something else entirely. '.repeat(2)}\n\n      at Object.toBe (jest/suite-${index}.test.js:1:1)\n`,
	).join('\n');
	const capsule = capsuleFor(null, `${many}\nTests:       40 failed, 0 passed, 40 total`);

	t.true(capsule.length <= TRUNCATION_OUTPUT_LIMIT, `${capsule.length}`);
	t.regex(capsule, /\+\d+ more failing \(not shown\)\./);
	t.true(capsule.endsWith('Summary: Tests: 40 failed, 0 passed, 40 total'));
});

test('buildFailureCapsule re-runs the narrowed command and reports the outcome', async t => {
	const reruns: string[] = [];
	const capsule = await buildFailureCapsule(bashState(), {
		cwd: CWD,
		originalLength: 5_000,
		rerun: async command => {
			reruns.push(command);
			return bashState({command, exitCode: 1});
		},
	});

	t.deepEqual(reruns, [
		"npx jest jest/ jest/auth.test.js -t 'refreshSession retries once on 401'",
	]);
	t.true(capsule?.includes('Re-ran it on its own: still fails (exit 1).'));
});

test('buildFailureCapsule does not re-run when the command cannot be narrowed', async t => {
	const reruns: string[] = [];
	const capsule = await buildFailureCapsule(
		bashState({command: 'npx tsc -p ts', stderr: '', fullOutput: TSC_OUTPUT}),
		{
			cwd: CWD,
			originalLength: 5_000,
			rerun: async command => {
				reruns.push(command);
				return null;
			},
		},
	);

	t.deepEqual(reruns, []);
	t.is(
		capsule,
		[
			'EXIT_CODE: 1',
			'FAILURE CAPSULE (tsc): 2 errors. Distilled from 5000 characters of output; only the failures are kept.',
			'Reproduce: npx tsc -p ts',
			'',
			"1) ts/user.ts:2:29 TS2322 Type 'string' is not assignable to type 'number'.",
			"2) ts/user.ts:3:42 TS2322 Type 'string' is not assignable to type 'number'.",
			'Summary: 2 TypeScript errors',
		].join('\n'),
	);
});

test('buildFailureCapsule still returns a capsule when the re-run throws', async t => {
	const capsule = await buildFailureCapsule(bashState(), {
		cwd: CWD,
		originalLength: 5_000,
		rerun: async () => {
			throw new Error('spawn failed');
		},
	});

	t.truthy(capsule);
	t.false(capsule?.includes('Re-ran'));
});

test('buildFailureCapsule returns null for unrecognised output', async t => {
	t.is(
		await buildFailureCapsule(
			bashState({stderr: 'Segmentation fault (core dumped)'}),
			{cwd: CWD, originalLength: 5_000},
		),
		null,
	);
});
