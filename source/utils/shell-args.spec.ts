import test from 'ava';
import {isWindowsCmd, shellArgs, shellEnv} from './shell-args';

test('shellArgs wraps one verbatim cmd.exe command and uses -c for posix shells', t => {
	t.deepEqual(shellArgs('cmd.exe', 'echo hi'), [
		'/d',
		'/v:on',
		'/s',
		'/c',
		'""%SystemRoot%\\System32\\chcp.com" 65001 >nul 2>&1 & "%ComSpec%" /d /v:off /s /c !NC_CMD_SCRIPT!"',
	]);
	t.deepEqual(shellArgs('cmd', 'echo hi'), [
		'/d',
		'/v:on',
		'/s',
		'/c',
		'""%SystemRoot%\\System32\\chcp.com" 65001 >nul 2>&1 & "%ComSpec%" /d /v:off /s /c !NC_CMD_SCRIPT!"',
	]);
	t.deepEqual(shellArgs('C:\\Windows\\System32\\cmd.exe', 'echo hi'), [
		'/d',
		'/v:on',
		'/s',
		'/c',
		'""%SystemRoot%\\System32\\chcp.com" 65001 >nul 2>&1 & "%ComSpec%" /d /v:off /s /c !NC_CMD_SCRIPT!"',
	]);
	t.deepEqual(shellArgs('/bin/sh', 'echo hi'), ['-c', 'echo hi']);
	t.deepEqual(shellArgs('/bin/bash', 'echo hi'), ['-c', 'echo hi']);
});

test('shellEnv hands the wrapped command to cmd.exe and nothing to posix shells', t => {
	t.deepEqual(shellEnv('cmd.exe', 'echo "a" & echo b'), {
		NC_CMD_SCRIPT: '"echo "a" & echo b"',
	});
	t.deepEqual(shellEnv('/bin/sh', 'echo hi'), {});
});

test('isWindowsCmd recognises cmd and cmd.exe by basename only', t => {
	t.true(isWindowsCmd('cmd'));
	t.true(isWindowsCmd('CMD.EXE'));
	t.true(isWindowsCmd('C:\\Windows\\System32\\cmd.exe'));
	t.false(isWindowsCmd('/bin/sh'));
	t.false(isWindowsCmd('/usr/bin/powershell'));
	t.false(isWindowsCmd('C:\\tools\\cmd-wrapper.exe'));
});
