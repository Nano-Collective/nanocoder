import test from 'ava';
import {getTuneToolMode, TUNE_DEFAULTS} from './config.js';
import type {TuneConfig} from './config.js';

console.log('\nconfig.spec.ts');

test('getTuneToolMode returns native when tune is undefined', t => {
	t.is(getTuneToolMode(undefined), 'native');
});

test('getTuneToolMode returns native when tune is disabled', t => {
	t.is(getTuneToolMode({...TUNE_DEFAULTS, enabled: false}), 'native');
});

test('getTuneToolMode returns native when enabled with no overrides', t => {
	t.is(getTuneToolMode({...TUNE_DEFAULTS, enabled: true}), 'native');
});

test('getTuneToolMode honors explicit toolMode = native', t => {
	const tune: TuneConfig = {
		...TUNE_DEFAULTS,
		enabled: true,
		toolMode: 'native',
	};
	t.is(getTuneToolMode(tune), 'native');
});

test('getTuneToolMode honors explicit toolMode = xml', t => {
	const tune: TuneConfig = {...TUNE_DEFAULTS, enabled: true, toolMode: 'xml'};
	t.is(getTuneToolMode(tune), 'xml');
});

test('getTuneToolMode honors explicit toolMode = json', t => {
	const tune: TuneConfig = {...TUNE_DEFAULTS, enabled: true, toolMode: 'json'};
	t.is(getTuneToolMode(tune), 'json');
});

test('getTuneToolMode maps legacy disableNativeTools=true to xml', t => {
	const tune: TuneConfig = {
		...TUNE_DEFAULTS,
		enabled: true,
		disableNativeTools: true,
	};
	t.is(getTuneToolMode(tune), 'xml');
});

test('getTuneToolMode: explicit toolMode wins over legacy disableNativeTools', t => {
	const tune: TuneConfig = {
		...TUNE_DEFAULTS,
		enabled: true,
		toolMode: 'json',
		disableNativeTools: true,
	};
	t.is(getTuneToolMode(tune), 'json');
});
