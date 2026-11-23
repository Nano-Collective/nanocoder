import {type ChildProcess, execFile, spawn} from 'node:child_process';

/**
 * Signal a spawned shell and everything it started.
 *
 * With a shell wrapper the child is `sh` / `cmd.exe`, not the user's command,
 * so signalling it alone leaves the real program running. On POSIX the caller
 * spawns it `detached`, so it leads its own process group and a negative pid
 * signals the whole group. Windows has no equivalent, so `taskkill /T` walks
 * the tree instead. taskkill /F is unconditional there, so `signal` only
 * matters on POSIX.
 */
export function signalProcessTree(
	proc: ChildProcess,
	signal: NodeJS.Signals = 'SIGTERM',
): void {
	const pid = proc.pid;
	if (pid === undefined) return;

	if (process.platform === 'win32') {
		killWindowsTree(pid, () => proc.kill('SIGKILL'));
		return;
	}

	try {
		// Negative pid = "the whole process group", which the detached spawn
		// made this process the leader of.
		process.kill(-pid, signal);
	} catch {
		// The group is already gone (or never formed) — fall back to the lone
		// shell, which may still be there even when the group is not.
		try {
			proc.kill(signal);
		} catch {
			// Nothing left to kill.
		}
	}
}

/**
 * Windows only: force-kill `pid` and everything it started, with
 * `taskkill /T /F`. `fallback` kills the process alone when taskkill cannot
 * be started (a stripped image); it defaults to TerminateProcess on `pid`.
 */
export function killWindowsTree(
	pid: number,
	fallback: () => void = () => process.kill(pid, 'SIGKILL'),
): void {
	const runFallback = () => {
		try {
			fallback();
		} catch {
			// Nothing left to kill.
		}
	};
	// /T kills the tree, /F forces it. Detached and unref'd so a slow
	// taskkill can't itself hold the session open. Fixed argv, no shell,
	// and the only interpolated value is a pid we minted or listed ourselves.
	try {
		// nosemgrep: javascript.lang.security.detect-child-process.detect-child-process
		const killer = spawn('taskkill', ['/pid', String(pid), '/T', '/F'], {
			stdio: 'ignore',
			detached: true,
		});
		killer.on('error', runFallback);
		killer.unref();
	} catch {
		runFallback();
	}
}

/**
 * Windows only: the processes that `parentPid` started and that are still
 * running after it exited, such as a job started with `start /b`.
 *
 * Windows keeps an orphan's ParentProcessId pointing at its dead parent, so
 * the children can still be found, but `taskkill /T` on the parent no longer
 * reaches them. The parent's pid may have been reused by then, so only
 * processes created within `[createdAfter, createdBefore]` (ms since the
 * epoch: the parent's spawn and exit) count. Resolves to an empty list when
 * the lookup fails; it never rejects.
 */
export function findWindowsOrphans(
	parentPid: number,
	createdAfter: number,
	createdBefore: number,
): Promise<number[]> {
	// Integer-checked so the filter below cannot carry anything but a pid.
	if (!Number.isSafeInteger(parentPid) || parentPid <= 0) {
		return Promise.resolve([]);
	}
	// wmic is gone from current Windows 11 builds, so ask CIM. One line per
	// child: "<pid> <creation time in ms since the epoch>".
	const script =
		`Get-CimInstance Win32_Process -Filter "ParentProcessId=${parentPid}" | ` +
		'ForEach-Object { "$($_.ProcessId) $(([DateTimeOffset]$_.CreationDate).ToUnixTimeMilliseconds())" }';
	return new Promise(resolve => {
		try {
			// nosemgrep: javascript.lang.security.detect-child-process.detect-child-process
			execFile(
				'powershell.exe',
				['-NoProfile', '-NonInteractive', '-Command', script],
				{windowsHide: true, timeout: 10_000},
				(error, stdout) => {
					if (error) {
						resolve([]);
						return;
					}
					const pids: number[] = [];
					for (const line of stdout.split(/\r?\n/)) {
						const [pid, created] = line.trim().split(' ').map(Number);
						if (
							Number.isSafeInteger(pid) &&
							pid > 0 &&
							created >= createdAfter &&
							created <= createdBefore
						) {
							pids.push(pid);
						}
					}
					resolve(pids);
				},
			);
		} catch {
			resolve([]);
		}
	});
}
