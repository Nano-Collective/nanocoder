import test from 'ava';
import {render} from 'ink-testing-library';
import React from 'react';
import {getThemeColors} from '@/config/themes';
import {ThemeContext} from '@/hooks/useTheme';
import type {SwarmSnapshot, SwarmStatus} from '@/swarm/types';
import {SwarmDashboard} from './swarm-dashboard';

const snapshot = (status: SwarmStatus): SwarmSnapshot => ({
	status,
	applied: false,
	runDir: '.nanocoder/swarm/x',
	patches: [{id: 'api', files: ['src/api/a.ts'], patchPath: 'api.patch'}],
	workers: [
		{
			id: 'api',
			status: 'running',
			fileScope: ['src/api'],
			currentTool: 'read_file',
			turns: 2,
			tokens: 0,
		},
		{id: 'ui', status: 'success', fileScope: ['src/ui'], turns: 3, tokens: 90},
	],
});

function mount(status: SwarmStatus) {
	const answers: boolean[] = [];
	let cancelled = 0;
	const instance = render(
		<ThemeContext.Provider
			value={{
				currentTheme: 'tokyo-night',
				colors: getThemeColors('tokyo-night'),
				setCurrentTheme: () => undefined,
			}}
		>
			<SwarmDashboard
				config={{
					prompt: 'goal',
					workers: 2,
					swarmMode: 'apply',
					timeoutMs: 1000,
				}}
				snapshot={snapshot(status)}
				onCancel={() => cancelled++}
				onConfirm={apply => answers.push(apply)}
			/>
		</ThemeContext.Provider>,
	);
	const press = async (input: string) => {
		await new Promise(resolve => setTimeout(resolve, 50));
		instance.stdin.write(input);
		await new Promise(resolve => setTimeout(resolve, 100));
	};
	return {instance, press, answers, cancelled: () => cancelled};
}

test('shows each worker with its activity', t => {
	const {instance} = mount('running');
	const frame = instance.lastFrame() ?? '';
	t.regex(frame, /api\s+running\s+read_file\s+turn 2/);
	t.regex(frame, /ui\s+success\s+src\/ui\s+90 tokens/);
	t.regex(frame, /Ctrl\+C to cancel/);
	t.notRegex(frame, /\(y\/n\)/);
	instance.unmount();
});

test('asks before applying and reports the answer', async t => {
	for (const [input, answer] of [
		['y', true],
		['n', false],
	] as const) {
		const {instance, press, answers} = mount('awaiting-confirmation');
		t.regex(instance.lastFrame() ?? '', /src\/api\/a\.ts[\s\S]*\(y\/n\)/);
		await press(input);
		t.deepEqual(answers, [answer]);
		instance.unmount();
	}
});

test('ignores y until asked, and cancels on Ctrl+C', async t => {
	const {instance, press, answers, cancelled} = mount('running');
	await press('y');
	await press('\u0003');
	t.deepEqual(answers, []);
	t.is(cancelled(), 1);
	instance.unmount();
});
