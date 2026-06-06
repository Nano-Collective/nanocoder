import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'ava';
import React from 'react';
import {renderWithTheme} from '../../test-utils/render-with-theme';
import {
	createStaticComponents,
	formatBootSummaryGitLabel,
} from './app-container';
import type {AppContainerProps} from './app-container';

test('createStaticComponents includes welcome message when shouldShowWelcome is true', t => {
	const props: AppContainerProps = {
		shouldShowWelcome: true,
		currentProvider: 'test-provider',
		currentModel: 'test-model',
	};

	const components = createStaticComponents(props);
	t.is(components.length, 2); // Welcome + BootSummary
	t.is((components[0] as React.ReactElement).key, 'welcome');
	t.is((components[1] as React.ReactElement).key, 'boot-summary');

	// Render and verify the components display correctly
	const {lastFrame, unmount} = renderWithTheme(<>{components}</>);
	const output = lastFrame();
	t.truthy(output);
	t.regex(output!, /Nanocoder/); // Welcome message should contain "Nanocoder"
	unmount();
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
// Boot Summary — Git Branch Display
// ============================================================================

test('formatBootSummaryGitLabel renders feature branch with ⎇ prefix', t => {
	t.is(
		formatBootSummaryGitLabel({
			branch: 'fix/read-file-empty',
			isDefault: false,
			detached: false,
		}),
		'⎇ fix/read-file-empty',
	);
});

test('formatBootSummaryGitLabel marks the default branch', t => {
	t.is(
		formatBootSummaryGitLabel({
			branch: 'main',
			isDefault: true,
			detached: false,
		}),
		'⎇ main (default)',
	);
});

test('formatBootSummaryGitLabel marks detached HEAD', t => {
	t.is(
		formatBootSummaryGitLabel({
			branch: 'abc1234',
			isDefault: false,
			detached: true,
		}),
		'⎇ abc1234 (detached)',
	);
});

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
		t.regex(output!, /⎇\s+\S+/);
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
			t.regex(output!, /⎇/);
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
			// provider/model line by a newline.
			t.regex(output!, /test-model[^\n]*\n⎇\s+\S+/);
			unmount();
		} finally {
			process.stdout.columns = originalColumns;
		}
	},
);
