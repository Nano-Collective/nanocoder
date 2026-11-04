import test from 'ava';
import {isWindowsCmd, shellArgs} from './shell-args';

test('shellArgs wraps one verbatim cmd.exe command and uses -c for posix shells', t => {
	t.deepEqual(shellArgs('cmd.exe', 'echo hi'), [
		'/d',
		'/v:off',
		'/s',
		'/c',
		'"echo hi"',
	]);
	t.deepEqual(shellArgs('cmd', 'echo hi'), [
		'/d',
		'/v:off',
		'/s',
		'/c',
		'"echo hi"',
	]);
	t.deepEqual(shellArgs('C:\\Windows\\System32\\cmd.exe', 'echo hi'), [
		'/d',
		'/v:off',
		'/s',
		'/c',
		'"echo hi"',
	]);
	t.deepEqual(shellArgs('/bin/sh', 'echo hi'), ['-c', 'echo hi']);
	t.deepEqual(shellArgs('/bin/bash', 'echo hi'), ['-c', 'echo hi']);
});

test('isWindowsCmd recognises cmd and cmd.exe by basename only', t => {
	t.true(isWindowsCmd('cmd'));
	t.true(isWindowsCmd('CMD.EXE'));
	t.true(isWindowsCmd('C:\\Windows\\System32\\cmd.exe'));
	t.false(isWindowsCmd('/bin/sh'));
	t.false(isWindowsCmd('/usr/bin/powershell'));
	t.false(isWindowsCmd('C:\\tools\\cmd-wrapper.exe'));
});
