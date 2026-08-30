import {existsSync, realpathSync} from 'node:fs';
import {delimiter, join} from 'node:path';

export type BashSpawnPlan =
	| {file: string; args: string[]; detached: boolean}
	| {error: string};

export function resolveJailRoot(root: string): string {
	try {
		return realpathSync(root);
	} catch {
		return root;
	}
}

export function findBwrap(
	pathEnv = process.env.PATH ?? '',
): string | undefined {
	for (const dir of pathEnv.split(delimiter)) {
		if (!dir) continue;
		const candidate = join(dir, 'bwrap');
		if (existsSync(candidate)) return candidate;
	}
	for (const candidate of ['/usr/bin/bwrap', '/usr/local/bin/bwrap']) {
		if (existsSync(candidate)) return candidate;
	}
	return undefined;
}

function seatbeltString(value: string): string {
	return `"${value.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`;
}

export function macSandboxProfile(projectRoot: string): string {
	return `(version 1)
(allow default)
(deny network*)
(deny file-write*
  (require-all
    (require-not (subpath ${seatbeltString(projectRoot)}))
    (require-not (subpath "/dev"))
    (require-not (subpath "/private/dev"))
  )
)
`;
}

export function planBashSpawn(input: {
	platform: string;
	sandbox: boolean;
	command: string;
	spawnCommand: string;
	cwd: string;
	projectRoot: string;
	bwrapPath?: string | null;
}): BashSpawnPlan {
	const {platform, sandbox, command, spawnCommand, cwd, projectRoot} = input;

	if (!sandbox) {
		if (platform === 'win32') {
			return {file: 'cmd', args: ['/c', command], detached: false};
		}
		return {file: 'sh', args: ['-c', spawnCommand], detached: true};
	}

	if (platform === 'win32') {
		return {
			error: 'OS sandbox is not supported on Windows. Unset nanocoder.sandbox.',
		};
	}

	if (platform === 'darwin') {
		if (!existsSync('/usr/bin/sandbox-exec')) {
			return {
				error:
					'OS sandbox is on but sandbox-exec was not found. Unset nanocoder.sandbox.',
			};
		}
		return {
			file: '/usr/bin/sandbox-exec',
			args: ['-p', macSandboxProfile(projectRoot), 'sh', '-c', spawnCommand],
			detached: true,
		};
	}

	const bwrap =
		input.bwrapPath === undefined
			? findBwrap()
			: (input.bwrapPath ?? undefined);
	if (!bwrap) {
		return {
			error:
				'OS sandbox is on but bubblewrap (bwrap) was not found. Install bubblewrap or unset nanocoder.sandbox.',
		};
	}

	return {
		file: bwrap,
		args: [
			'--die-with-parent',
			'--unshare-net',
			'--ro-bind',
			'/',
			'/',
			'--dev',
			'/dev',
			'--proc',
			'/proc',
			'--bind',
			projectRoot,
			projectRoot,
			'--chdir',
			cwd,
			'sh',
			'-c',
			spawnCommand,
		],
		detached: true,
	};
}
