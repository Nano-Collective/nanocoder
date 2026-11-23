import test from 'ava';
import {
	buildOsc52Sequence,
	type ClipboardDependencies,
	copyTextToClipboard,
	OSC52_MAX_BASE64_LENGTH,
} from './clipboard';

const ESC = '\u001b';
const BEL = '\u0007';

function createDependencies(
	overrides: Partial<ClipboardDependencies> = {},
): ClipboardDependencies & {terminalWrites: string[]; systemWrites: string[]} {
	const terminalWrites: string[] = [];
	const systemWrites: string[] = [];
	return {
		terminalWrites,
		systemWrites,
		writeSystem: async text => {
			systemWrites.push(text);
		},
		writeTerminal: data => {
			terminalWrites.push(data);
		},
		isTerminal: () => true,
		env: {},
		...overrides,
	};
}

test('buildOsc52Sequence encodes the text as base64 UTF-8', t => {
	t.is(
		buildOsc52Sequence('héllo', {}),
		`${ESC}]52;c;${Buffer.from('héllo', 'utf8').toString('base64')}${BEL}`,
	);
});

test('buildOsc52Sequence wraps the sequence for tmux and doubles its ESC bytes', t => {
	const payload = Buffer.from('hi', 'utf8').toString('base64');
	t.is(
		buildOsc52Sequence('hi', {TMUX: '/tmp/tmux-1000/default,1,0'}),
		`${ESC}Ptmux;${ESC}${ESC}]52;c;${payload}${BEL}${ESC}\\`,
	);
});

test('buildOsc52Sequence wraps the sequence for GNU screen', t => {
	const payload = Buffer.from('hi', 'utf8').toString('base64');
	t.is(
		buildOsc52Sequence('hi', {STY: '123.pts-0.host'}),
		`${ESC}P${ESC}]52;c;${payload}${BEL}${ESC}\\`,
	);
});

test('buildOsc52Sequence refuses a payload above the size limit', t => {
	// 3 bytes become 4 base64 characters
	const atLimit = 'a'.repeat((OSC52_MAX_BASE64_LENGTH / 4) * 3);
	t.truthy(buildOsc52Sequence(atLimit, {}));
	t.is(buildOsc52Sequence(`${atLimit}a`, {}), undefined);
});

test('copyTextToClipboard uses the system clipboard and sends nothing to the terminal locally', async t => {
	const dependencies = createDependencies();
	t.is(await copyTextToClipboard('hello', dependencies), 'system');
	t.deepEqual(dependencies.systemWrites, ['hello']);
	t.deepEqual(dependencies.terminalWrites, []);
});

test('copyTextToClipboard falls back to OSC 52 when the system clipboard fails', async t => {
	const dependencies = createDependencies({
		writeSystem: async () => {
			throw new Error('no xclip');
		},
	});
	t.is(await copyTextToClipboard('hello', dependencies), 'osc52');
	t.deepEqual(dependencies.terminalWrites, [buildOsc52Sequence('hello', {})]);
});

test('copyTextToClipboard also sends OSC 52 over SSH when the system write works', async t => {
	for (const env of [{SSH_TTY: '/dev/pts/1'}, {SSH_CONNECTION: '1.2.3.4 1 5.6.7.8 22'}]) {
		const dependencies = createDependencies({env});
		t.is(await copyTextToClipboard('hello', dependencies), 'osc52');
		t.deepEqual(dependencies.systemWrites, ['hello']);
		t.is(dependencies.terminalWrites.length, 1);
	}
});

test('copyTextToClipboard wraps the fallback for tmux over SSH', async t => {
	const env = {SSH_TTY: '/dev/pts/1', TMUX: '/tmp/tmux-1000/default,1,0'};
	const dependencies = createDependencies({env});
	await copyTextToClipboard('hello', dependencies);
	t.deepEqual(dependencies.terminalWrites, [buildOsc52Sequence('hello', env)]);
	t.true(dependencies.terminalWrites[0]?.startsWith(`${ESC}Ptmux;`));
});

test('copyTextToClipboard rethrows the system error when output is not a terminal', async t => {
	const dependencies = createDependencies({
		isTerminal: () => false,
		writeSystem: async () => {
			throw new Error('no xclip');
		},
	});
	await t.throwsAsync(copyTextToClipboard('hello', dependencies), {
		message: 'no xclip',
	});
	t.deepEqual(dependencies.terminalWrites, []);
});

test('copyTextToClipboard rethrows the system error when the text is too large for OSC 52', async t => {
	const dependencies = createDependencies({
		writeSystem: async () => {
			throw new Error('no xclip');
		},
	});
	await t.throwsAsync(
		copyTextToClipboard('a'.repeat(OSC52_MAX_BASE64_LENGTH), dependencies),
		{message: 'no xclip'},
	);
	t.deepEqual(dependencies.terminalWrites, []);
});

test('copyTextToClipboard reports the system route over SSH when output is not a terminal', async t => {
	const dependencies = createDependencies({
		env: {SSH_TTY: '/dev/pts/1'},
		isTerminal: () => false,
	});
	t.is(await copyTextToClipboard('hello', dependencies), 'system');
	t.deepEqual(dependencies.terminalWrites, []);
});
