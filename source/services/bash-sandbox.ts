import {type ChildProcess, spawn} from 'node:child_process';
import {existsSync, realpathSync} from 'node:fs';
import {delimiter, join} from 'node:path';

export type BashSpawnPlan =
	| {bin: 'cmd'; args: string[]; detached: false}
	| {bin: 'sh'; args: string[]; detached: true}
	| {bin: 'sandbox-exec'; args: string[]; detached: true}
	| {bin: 'bwrap'; bwrap: string; args: string[]; detached: true}
	| {error: string};

export type JailSpawnPlan = Extract<
	BashSpawnPlan,
	{bin: 'sandbox-exec' | 'bwrap'}
>;

export function resolveJailRoot(root: string): string {
	try {
		return realpathSync(root);
	} catch {
		return root;
	}
}

export function findBwrap(pathEnv = process.env.PATH): string | undefined {
	if (!pathEnv) return undefined;
	for (const dir of pathEnv.split(delimiter)) {
		if (!dir) continue;
		const candidate = join(dir, 'bwrap');
		if (existsSync(candidate)) return candidate;
	}
	return undefined;
}

function seatbeltString(value: string): string {
	return `"${value.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`;
}

export function macSandboxProfile(
	projectRoot: string,
	writableRoots: string[],
): string {
	const extras = [projectRoot, ...writableRoots, '/dev', '/private/dev']
		.map(root => `    (require-not (subpath ${seatbeltString(root)}))`)
		.join('\n');
	return `(version 1)
(allow default)
(deny network*)
(deny file-write*
  (require-all
${extras}
  )
)
`;
}

function bwrapArgs(
	cwd: string,
	projectRoot: string,
	tmpDir: string,
	spawnCommand: string,
): string[] {
	return [
		'--die-with-parent',
		'--new-session',
		'--unshare-net',
		'--ro-bind',
		'/',
		'/',
		'--dev',
		'/dev',
		'--proc',
		'/proc',
		'--tmpfs',
		'/tmp',
		'--bind',
		projectRoot,
		projectRoot,
		'--bind',
		tmpDir,
		tmpDir,
		'--chdir',
		cwd,
		'sh',
		'-c',
		spawnCommand,
	];
}

type PlanInput = {
	platform: string;
	sandbox: boolean;
	command: string;
	spawnCommand: string;
	cwd: string;
	projectRoot: string;
	tmpDir?: string;
	hostTmp?: string;
	bwrapPath?: string | null;
};

export function planBashSpawn(
	input: PlanInput & {sandbox: true},
): JailSpawnPlan | {error: string};
export function planBashSpawn(input: PlanInput): BashSpawnPlan;
export function planBashSpawn(input: PlanInput): BashSpawnPlan {
	const {platform, sandbox, command, spawnCommand, cwd, projectRoot} = input;

	if (!sandbox) {
		if (platform === 'win32') {
			return {bin: 'cmd', args: ['/c', command], detached: false};
		}
		return {bin: 'sh', args: ['-c', spawnCommand], detached: true};
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
			bin: 'sandbox-exec',
			args: [
				'-p',
				macSandboxProfile(
					projectRoot,
					[input.tmpDir ?? '', input.hostTmp ?? ''].filter(Boolean),
				),
				'sh',
				'-c',
				spawnCommand,
			],
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
		bin: 'bwrap',
		bwrap,
		args: bwrapArgs(cwd, projectRoot, input.tmpDir ?? '', spawnCommand),
		detached: true,
	};
}

export function spawnPlanned(
	plan: JailSpawnPlan,
	options: {cwd: string; env?: NodeJS.ProcessEnv},
): ChildProcess {
	const spawnOpts = {
		cwd: options.cwd,
		env: options.env,
		detached: true,
	};
	if (plan.bin === 'sandbox-exec') {
		// codeql[js/shell-command-built-from-environment] seatbelt profile paths are bind roots, not a shell
		// codeql[js/shell-command-constructed-from-input]
		return spawn('/usr/bin/sandbox-exec', plan.args, spawnOpts);
	}
	// codeql[js/shell-command-built-from-environment] resolved bwrap path; argv is not a shell string
	// codeql[js/shell-command-constructed-from-input]
	return spawn(plan.bwrap, plan.args, spawnOpts);
}
