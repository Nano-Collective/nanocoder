import {type ChildProcess, spawn} from 'node:child_process';

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
		// /T kills the tree, /F forces it. Detached and unref'd so a slow
		// taskkill can't itself hold the session open. Fixed argv, no shell,
		// and the only interpolated value is a pid we minted ourselves.
		try {
			// nosemgrep: javascript.lang.security.detect-child-process.detect-child-process
			const killer = spawn('taskkill', ['/pid', String(pid), '/T', '/F'], {
				stdio: 'ignore',
				detached: true,
			});
			killer.on('error', () => {
				// taskkill missing (a stripped image): fall back to the shell alone.
				try {
					proc.kill('SIGKILL');
				} catch {
					// Nothing left to kill.
				}
			});
			killer.unref();
		} catch {
			try {
				proc.kill('SIGKILL');
			} catch {
				// Nothing left to kill.
			}
		}
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
