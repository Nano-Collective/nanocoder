import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'ava';
import React from 'react';
import stripAnsi from 'strip-ansi';
import {renderWithTheme} from '../../test-utils/render-with-theme';
import {
	createStaticComponents,
	formatBootSummaryProjectLabel,
} from './app-container';
import type {AppContainerProps} from './app-container';

test('createStaticComponents includes welcome message when shouldShowWelcome is true', t => {
	const props: AppContainerProps = {
		shouldShowWelcome: true,
		currentProvider: 'test-provider',
		currentModel: 'test-model',
	};

	const components = createStaticComponents(props);
	t.is(components.length, 1); // Only welcome — boot summary is suppressed when welcome is shown
	t.is((components[0] as React.ReactElement).key, 'welcome');

	// Render and verify the components display correctly
	const {lastFrame, unmount} = renderWithTheme(<>{components}</>);
	const output = lastFrame();
	t.truthy(output);
	t.regex(output!, /Nanocoder/); // Welcome message should contain "Nanocoder"
	unmount();
});

test('createStaticComponents passes the row budget to the welcome banner', t => {
	const originalColumns = process.stdout.columns;
	process.stdout.columns = 80;

	// Fullscreen clips at the chat viewport, so the banner is handed the rows
	// left after the input footer - not the terminal height.
	const components = createStaticComponents({
		shouldShowWelcome: true,
		currentProvider: 'test-provider',
		currentModel: 'test-model',
		availableRows: 17,
	});

	const {lastFrame, unmount} = renderWithTheme(<>{components}</>);
	const output = stripAnsi(lastFrame() ?? '');
	t.regex(output, /Resume session/, 'the full menu must survive the budget');
	t.regex(output, /Tip:/, 'the tip must survive the budget');
	t.notRegex(output, /█/, 'the block wordmark does not fit 17 rows');
	unmount();

	process.stdout.columns = originalColumns;
});

test('createStaticComponents excludes welcome message when shouldShowWelcome is false', t => {
	const props: AppContainerProps = {
		shouldShowWelcome: false,
		currentProvider: 'test-provider',
		currentModel: 'test-model',
	};

	const components = createStaticComponents(props);
	t.is(components.length, 1); // Only BootSummary
	t.is((components[0] as React.ReactElement).key, 'boot-summary');

	// Render and verify the components display correctly
	const {lastFrame, unmount} = renderWithTheme(<>{components}</>);
	const output = lastFrame();
	t.truthy(output);
	t.regex(output!, /test-provider/); // Should show provider name
	t.regex(output!, /test-model/); // Should show model name
	unmount();
});

test('createStaticComponents includes boot summary with provider and model', t => {
	const props: AppContainerProps = {
		shouldShowWelcome: false,
		currentProvider: 'local',
		currentModel: 'gpt-4',
	};

	const components = createStaticComponents(props);
	const bootSummary = components.find(
		c => (c as React.ReactElement).key === 'boot-summary',
	) as React.ReactElement;

	t.truthy(bootSummary);

	// Render and verify the components display correctly
	const {lastFrame, unmount} = renderWithTheme(<>{components}</>);
	const output = lastFrame();
	t.truthy(output);
	t.regex(output!, /local/); // Provider name
	t.regex(output!, /gpt-4/); // Model name
	unmount();
});

test('createStaticComponents omits boot summary when no provider or model', t => {
	const props: AppContainerProps = {
		shouldShowWelcome: false,
		currentProvider: '',
		currentModel: '',
	};

	const components = createStaticComponents(props);
	t.is(components.length, 0);
});

test('createStaticComponents renders boot summary with mode in non-interactive mode', t => {
	const props: AppContainerProps = {
		shouldShowWelcome: false,
		currentProvider: 'test-provider',
		currentModel: 'test-model',
		nonInteractiveMode: true,
		developmentMode: 'yolo',
	};

	const components = createStaticComponents(props);
	t.is(components.length, 1);
	t.is((components[0] as React.ReactElement).key, 'boot-summary');

	const {lastFrame, unmount} = renderWithTheme(<>{components}</>);
	const output = lastFrame();
	t.truthy(output);
	t.regex(output!, /test-provider/);
	t.regex(output!, /test-model/);
	// Mode label (e.g. "⏵⏵⏵ yolo mode on") is surfaced.
	t.regex(output!, /yolo/);
	unmount();
});

test('createStaticComponents omits mode label when interactive', t => {
	const props: AppContainerProps = {
		shouldShowWelcome: false,
		currentProvider: 'test-provider',
		currentModel: 'test-model',
		developmentMode: 'yolo',
	};

	const components = createStaticComponents(props);
	t.is(components.length, 1);

	const {lastFrame, unmount} = renderWithTheme(<>{components}</>);
	const output = lastFrame();
	t.truthy(output);
	// Interactive mode relies on the live status bar — mode label is not in
	// the static boot line.
	t.notRegex(output!, /yolo/);
	unmount();
});

// ============================================================================
// Boot Summary — Project and Git Branch Display
// ============================================================================

test('formatBootSummaryProjectLabel renders workspace without git status', t => {
	t.is(formatBootSummaryProjectLabel('/work/example', null), '/work/example');
});

test('formatBootSummaryProjectLabel appends feature branch', t => {
	t.is(
		formatBootSummaryProjectLabel('/work/example', {
			branch: 'fix/read-file-empty',
			isDefault: false,
			detached: false,
		}),
		'/work/example · fix/read-file-empty',
	);
});

test('formatBootSummaryProjectLabel leaves the default branch unmarked', t => {
	t.is(
		formatBootSummaryProjectLabel('/work/example', {
			branch: 'main',
			isDefault: true,
			detached: false,
		}),
		'/work/example · main',
	);
});

test('formatBootSummaryProjectLabel marks detached HEAD', t => {
	t.is(
		formatBootSummaryProjectLabel('/work/example', {
			branch: 'abc1234',
			isDefault: false,
			detached: true,
		}),
		'/work/example · abc1234 (detached)',
	);
});

// Keep legacy formatter coverage because /status and external callers share
// the branch marker semantics.

test.serial(
	'createStaticComponents boot summary includes working directory (cwd) rather than config dir',
	t => {
		const originalCwd = process.cwd;
		try {
			process.cwd = () => '/mock/working/dir';
			const props: AppContainerProps = {
				shouldShowWelcome: false,
				currentProvider: 'mock-provider',
				currentModel: 'mock-model',
			};
			const components = createStaticComponents(props);
			const output = stripAnsi(renderWithTheme(<>{components}</>).lastFrame() ?? '');
			t.regex(output, /\/mock\/working\/dir/);
		} finally {
			process.cwd = originalCwd;
		}
	},
);

test.serial(
	'createStaticComponents boot summary includes git branch when inside a repo',
	t => {
		// The repo we're running tests in is itself a git repo, so the
		// boot summary should pick it up via getGitStatusSummarySync().
		const props: AppContainerProps = {
			shouldShowWelcome: false,
			currentProvider: 'test-provider',
			currentModel: 'test-model',
		};

		const components = createStaticComponents(props);
		const {lastFrame, unmount} = renderWithTheme(<>{components}</>);
		const output = lastFrame();
		t.truthy(output);
		t.regex(output!, /[^\n]+\s+·\s+\S+/);
		unmount();
	},
);

test.serial(
	'createStaticComponents boot summary omits branch when not in a repo',
	t => {
		const dir = mkdtempSync(join(tmpdir(), 'nanocoder-boot-test-'));
		const originalCwd = process.cwd();
		try {
			process.chdir(dir);
			const props: AppContainerProps = {
				shouldShowWelcome: false,
				currentProvider: 'test-provider',
				currentModel: 'test-model',
			};

			const components = createStaticComponents(props);
			const {lastFrame, unmount} = renderWithTheme(<>{components}</>);
			const output = lastFrame();
			t.truthy(output);
			t.regex(output!, new RegExp(stripAnsi(process.cwd()).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
			t.notRegex(output!, /⎇/);
			unmount();
		} finally {
			process.chdir(originalCwd);
			rmSync(dir, {recursive: true, force: true});
		}
	},
);

test.serial(
	'createStaticComponents narrow boot summary still includes branch',
	t => {
		const originalColumns = process.stdout.columns;
		process.stdout.columns = 50;
		try {
			const props: AppContainerProps = {
				shouldShowWelcome: false,
				currentProvider: 'test-provider',
				currentModel: 'test-model',
			};
			const components = createStaticComponents(props);
			const {lastFrame, unmount} = renderWithTheme(<>{components}</>);
			const output = lastFrame();
			t.truthy(output);
			t.regex(output!, /\S+\s+·\s+\S+/);
			unmount();
		} finally {
			process.stdout.columns = originalColumns;
		}
	},
);

test.serial(
	'createStaticComponents narrow boot summary places branch on its own line',
	t => {
		const originalColumns = process.stdout.columns;
		process.stdout.columns = 50;
		try {
			const props: AppContainerProps = {
				shouldShowWelcome: false,
				currentProvider: 'test-provider',
				currentModel: 'test-model',
			};
			const components = createStaticComponents(props);
			const {lastFrame, unmount} = renderWithTheme(<>{components}</>);
			const output = lastFrame();
			t.truthy(output);
			// Branch label sits on a line by itself, separated from the
			// provider/model line by a newline. Strip ANSI so color codes
			// (present when CI forces color) don't break the adjacency match.
			t.regex(stripAnsi(output!), /test-model[^\n]*\n\S+.*\s+·\s+\S+/);
			unmount();
		} finally {
			process.stdout.columns = originalColumns;
		}
	},
);

test.serial(
	'createStaticComponents narrow boot summary keeps the workspace when the model is unknown',
	t => {
		const originalColumns = process.stdout.columns;
		process.stdout.columns = 50;
		try {
			const components = createStaticComponents({
				shouldShowWelcome: false,
				currentProvider: 'test-provider',
				currentModel: '',
			});
			const {lastFrame, unmount} = renderWithTheme(<>{components}</>);
			const output = stripAnsi(lastFrame() ?? '');
			// The wide layout falls back to the workspace line; narrow used to
			// render nothing at all.
			t.true(output.replace(/\s+/g, '').includes(process.cwd().split('/').pop()!));
			unmount();
		} finally {
			process.stdout.columns = originalColumns;
		}
	},
);
