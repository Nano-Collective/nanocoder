import test from 'ava';
import {color, isAnsiEnabled} from './writer.js';

// Each test snapshots and restores the env vars it touches so tests stay
// independent (AVA serial mode is on, so no concurrency concerns).
function withEnv(
	overrides: Record<string, string | undefined>,
	fn: () => void,
): void {
	const previous: Record<string, string | undefined> = {};
	for (const key of Object.keys(overrides)) {
		previous[key] = process.env[key];
		const next = overrides[key];
		if (next === undefined) {
			delete process.env[key];
		} else {
			process.env[key] = next;
		}
	}
	try {
		fn();
	} finally {
		for (const key of Object.keys(previous)) {
			const original = previous[key];
			if (original === undefined) {
				delete process.env[key];
			} else {
				process.env[key] = original;
			}
		}
	}
}

test('color: returns plain text when NO_COLOR is set', t => {
	withEnv({NO_COLOR: '1', FORCE_COLOR: undefined}, () => {
		t.is(color('red', 'hello'), 'hello');
	});
});

test('color: emits ANSI when FORCE_COLOR is set', t => {
	withEnv({NO_COLOR: undefined, FORCE_COLOR: '1'}, () => {
		const result = color('green', 'ok');
		t.true(result.startsWith('\x1b[32m'));
		t.true(result.endsWith('\x1b[0m'));
		t.true(result.includes('ok'));
	});
});

test('color: NO_COLOR wins over FORCE_COLOR', t => {
	withEnv({NO_COLOR: '1', FORCE_COLOR: '1'}, () => {
		t.is(color('red', 'plain'), 'plain');
	});
});

test('isAnsiEnabled: false when NO_COLOR is set', t => {
	withEnv({NO_COLOR: '1', FORCE_COLOR: undefined}, () => {
		t.false(isAnsiEnabled());
	});
});

test('isAnsiEnabled: true when FORCE_COLOR is set', t => {
	withEnv({NO_COLOR: undefined, FORCE_COLOR: '1'}, () => {
		t.true(isAnsiEnabled());
	});
});
