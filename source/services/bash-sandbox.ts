import {type ChildProcess, spawn} from 'node:child_process';
import {existsSync, realpathSync} from 'node:fs';

export type BwrapBin = '/usr/bin/bwrap' | '/usr/local/bin/bwrap';

export type BashSpawnPlan =
	| {bin: 'cmd'; args: string[]; detached: false}
	| {bin: 'sh'; args: string[]; detached: true}
	| {bin: 'sandbox-exec'; args: string[]; detached: true}
	| {bin: 'bwrap'; bwrap: BwrapBin; args: string[]; detached: true}
	| {error: string};

export function resolveJailRoot(root: string): string {
	try {
		return realpathSync(root);
	} catch {
		return root;
	}
}

const BWRAP_USR = '/usr/bin/bwrap';
const BWRAP_LOCAL = '/usr/local/bin/bwrap';

function findBwrap(): BwrapBin | undefined {
	if (existsSync(BWRAP_USR)) return BWRAP_USR;
	if (existsSync(BWRAP_LOCAL)) return BWRAP_LOCAL;
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

function shDashC(spawnCommand: string, cwdCaptureFile?: string): string[] {
	return cwdCaptureFile
		? ['-c', spawnCommand, 'sh', cwdCaptureFile]
		: ['-c', spawnCommand];
}

function bwrapArgs(
	cwd: string,
	projectRoot: string,
	spawnCommand: string,
	cwdCaptureFile?: string,
): string[] {
	return [
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
		...shDashC(spawnCommand, cwdCaptureFile),
	];
}

export type JailSpawnPlan = Extract<
	BashSpawnPlan,
	{bin: 'sandbox-exec' | 'bwrap'}
>;

type PlanInput = {
	platform: string;
	sandbox: boolean;
	command: string;
	spawnCommand: string;
	cwd: string;
	projectRoot: string;
	cwdCaptureFile?: string;
	bwrapPath?: BwrapBin | null;
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
		return {
			bin: 'sh',
			args: shDashC(spawnCommand, input.cwdCaptureFile),
			detached: true,
		};
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
				macSandboxProfile(projectRoot),
				'sh',
				...shDashC(spawnCommand, input.cwdCaptureFile),
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
		args: bwrapArgs(cwd, projectRoot, spawnCommand, input.cwdCaptureFile),
		detached: true,
	};
}

export function spawnPlanned(plan: JailSpawnPlan, cwd: string): ChildProcess {
	// `detached` makes the child a process-group leader so cancel() can
	// signal the whole tree, not just the wrapper.
	if (plan.bin === 'sandbox-exec') {
		return spawn('/usr/bin/sandbox-exec', plan.args, {cwd, detached: true});
	}
	if (plan.bwrap === '/usr/bin/bwrap') {
		return spawn('/usr/bin/bwrap', plan.args, {cwd, detached: true});
	}
	return spawn('/usr/local/bin/bwrap', plan.args, {cwd, detached: true});
}
