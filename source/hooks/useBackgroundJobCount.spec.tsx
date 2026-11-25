import {mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'ava';
import {Text} from 'ink';
import {render} from 'ink-testing-library';
import React from 'react';
import {bashExecutor} from '@/services/bash-executor';
import {useBackgroundJobCount} from './useBackgroundJobCount';

console.log('\nuseBackgroundJobCount.spec.tsx');

const dir = mkdtempSync(join(tmpdir(), 'nc-job-count-hook-'));
const script = join(dir, 'sleeper.js');
writeFileSync(script, 'setInterval(() => {}, 1000);\n');
const SLEEPER = `node "${script}"`;

function CountProbe() {
	const count = useBackgroundJobCount();
	return React.createElement(Text, null, String(count));
}

async function waitForCount(
	read: () => string | undefined,
	expected: string,
): Promise<void> {
	const deadline = Date.now() + 3000;
	while (read() !== expected && Date.now() < deadline) {
		await new Promise(resolve => setTimeout(resolve, 25));
	}
}

test.afterEach.always(async () => {
	await bashExecutor.stopAll();
});

test.after.always(() => {
	rmSync(dir, {recursive: true, force: true});
});

test('useBackgroundJobCount follows executor start and complete events', async t => {
	const {lastFrame, unmount} = render(React.createElement(CountProbe));
	t.is(lastFrame(), '0', 'an idle executor reports no jobs');

	const {executionId} = bashExecutor.execute(SLEEPER, {background: true});
	await waitForCount(lastFrame, '1');
	t.is(lastFrame(), '1', 'starting a job updates the badge count');

	await bashExecutor.killJob(executionId);
	await waitForCount(lastFrame, '0');
	t.is(lastFrame(), '0', 'stopping the job clears the badge count');

	unmount();
});

test('useBackgroundJobCount ignores foreground start events', async t => {
	const {lastFrame, unmount} = render(React.createElement(CountProbe));

	await bashExecutor.execute('echo foreground').promise;
	await new Promise(resolve => setTimeout(resolve, 50));
	t.is(lastFrame(), '0', 'foreground commands are not background jobs');

	unmount();
});
