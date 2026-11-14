import {type ChildProcess, spawn, spawnSync} from 'node:child_process';
import {
	existsSync,
	lstatSync,
	realpathSync,
	rmdirSync,
	statSync,
	unlinkSync,
} from 'node:fs';
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
		try {
			if (statSync(candidate).isFile()) return candidate;
		} catch {
			continue;
		}
	}
	return undefined;
}

const bwrapJailCache = new Map<string, boolean>();

// --new-session starts the command in a session of its own, outside the
// process group bwrap was spawned into, so signalling that group reaches only
// bwrap. bwrap reports the command's pid on --info-fd; as a session leader
// that pid is also the command's process group id.
const commandGroups = new WeakMap<ChildProcess, number>();

/** The process group bwrap started the command in, once bwrap has said. */
export function sandboxedCommandGroup(proc: ChildProcess): number | undefined {
	return commandGroups.get(proc);
}

function bwrapCanUnshareNet(bwrap: string): boolean {
	const hit = bwrapJailCache.get(bwrap);
	if (hit !== undefined) return hit;
	const result = spawnSync(
		bwrap,
		['--unshare-net', '--die-with-parent', '--ro-bind', '/', '/', '/bin/true'],
		{timeout: 3000, stdio: 'ignore'},
	);
	const ok = result.status === 0;
	bwrapJailCache.set(bwrap, ok);
	return ok;
}

function seatbeltString(value: string): string {
	return `"${value.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`;
}

/**
 * Entries under the project root the jail can read but never write. Each is
 * run by something outside the jail: git reads `.git` (config such as
 * core.fsmonitor, hooks) when nanocoder's own git tools run, and nanocoder
 * loads plugins, custom tools, lifecycle hooks and MCP server commands from
 * the rest on its next start.
 */
const PROTECTED_PROJECT_ENTRIES = [
	{name: '.git', kind: 'dir'},
	{name: '.nanocoder', kind: 'dir'},
	{name: 'agents.config.json', kind: 'file'},
	{name: '.mcp.json', kind: 'file'},
] as const;

type ProtectedKind = (typeof PROTECTED_PROJECT_ENTRIES)[number]['kind'];

/**
 * How bwrap keeps one protected entry read-only. An entry that exists is
 * bound over itself read-only. One that does not would be free to create, so
 * a read-only placeholder is mounted there instead; bwrap creates its mount
 * point on the host, an empty file or directory that the `release` from
 * acquireProtectedMounts() removes again.
 */
export type ProtectedMount = {path: string; placeholder?: ProtectedKind};

// Placeholders still mounted in some jail, with how many jails hold each.
// Removing one on the host detaches the mount in every jail still holding it,
// so it stays until the last of them is gone.
const placeholders = new Map<string, {kind: ProtectedKind; holders: number}>();

/**
 * Reserve the protected mounts for a bwrap jail over `projectRoot`. Call the
 * returned `release` once nothing in that jail can still be running.
 */
export function acquireProtectedMounts(
	projectRoot: string,
	exists: (path: string) => boolean = existsSync,
): {mounts: ProtectedMount[]; release: () => void} {
	const held: string[] = [];
	const mounts = PROTECTED_PROJECT_ENTRIES.map(
		({name, kind}): ProtectedMount => {
			const path = join(projectRoot, name);
			const shared = placeholders.get(path);
			if (shared) {
				shared.holders++;
				held.push(path);
				return {path, placeholder: shared.kind};
			}
			if (exists(path)) return {path};
			placeholders.set(path, {kind, holders: 1});
			held.push(path);
			return {path, placeholder: kind};
		},
	);
	let released = false;
	return {
		mounts,
		release: () => {
			if (released) return;
			released = true;
			for (const path of held) dropPlaceholder(path);
		},
	};
}

function dropPlaceholder(path: string): void {
	const entry = placeholders.get(path);
	if (!entry) return;
	entry.holders--;
	if (entry.holders > 0) return;
	placeholders.delete(path);
	// Only remove what is still the empty mount point: if something on the
	// host filled it in meanwhile (a wizard writing agents.config.json), that
	// is real content.
	try {
		const stat = lstatSync(path);
		if (entry.kind === 'dir' && stat.isDirectory()) rmdirSync(path);
		else if (entry.kind === 'file' && stat.isFile() && stat.size === 0) {
			unlinkSync(path);
		}
	} catch {
		// Gone already, or no longer empty.
	}
}

export function macSandboxProfile(
	projectRoot: string,
	writableRoots: string[],
): string {
	const extras = [projectRoot, ...writableRoots, '/dev', '/private/dev']
		.map(root => `    (require-not (subpath ${seatbeltString(root)}))`)
		.join('\n');
	const readOnly = PROTECTED_PROJECT_ENTRIES.map(
		({name}) => `  (subpath ${seatbeltString(join(projectRoot, name))})`,
	).join('\n');
	// The later deny wins over the project-root allowance above it. Seatbelt
	// checks the path, so a missing entry cannot be created either.
	// LaunchServices and Apple Events would have `open` and `osascript` start
	// programs outside the jail.
	return `(version 1)
(allow default)
(deny network*)
(deny file-write*
  (require-all
${extras}
  )
)
(deny file-write*
${readOnly}
)
(deny appleevent-send)
(deny mach-lookup
  (global-name "com.apple.coreservices.launchservicesd")
  (global-name "com.apple.coreservices.quarantine-resolver")
  (global-name-prefix "com.apple.lsd.")
)
`;
}

/**
 * Unix sockets that reach a service outside the jail. --unshare-net does not
 * cover sockets on the filesystem, and the Docker daemon or a D-Bus bus would
 * start programs on the jail's behalf.
 */
const HOST_SOCKETS = [
	'/run/docker.sock',
	'/var/run/docker.sock',
	'/run/podman/podman.sock',
	'/run/dbus/system_bus_socket',
	'/var/run/dbus/system_bus_socket',
];

/** What the jail hides of the host's sockets. */
export type HostMasks = {runtimeDir?: string; sockets: string[]};

function bwrapMaskArgs({runtimeDir, sockets}: HostMasks): string[] {
	const args: string[] = [];
	// The per-user runtime dir holds the session bus, the systemd user
	// manager, rootless Docker and Podman, and agent sockets.
	if (runtimeDir) args.push('--tmpfs', runtimeDir);
	// Only sockets that exist: bwrap cannot create a mount point under the
	// read-only root.
	for (const socket of sockets) {
		args.push('--ro-bind', '/dev/null', socket);
	}
	return args;
}

function bwrapProtectArgs(mounts: ProtectedMount[]): string[] {
	const args: string[] = [];
	for (const {path, placeholder} of mounts) {
		if (placeholder === 'dir') {
			args.push('--tmpfs', path, '--remount-ro', path);
		} else if (placeholder === 'file') {
			args.push('--ro-bind', '/dev/null', path);
		} else {
			args.push('--ro-bind', path, path);
		}
	}
	return args;
}

function existingProtectedMounts(projectRoot: string): ProtectedMount[] {
	return PROTECTED_PROJECT_ENTRIES.map(({name}) => join(projectRoot, name))
		.filter(path => existsSync(path))
		.map(path => ({path}));
}

function defaultHostMasks(): HostMasks {
	const uid = process.getuid?.();
	const runtimeDir = uid === undefined ? undefined : `/run/user/${uid}`;
	return {
		runtimeDir:
			runtimeDir && existsSync(runtimeDir)
				? resolveJailRoot(runtimeDir)
				: undefined,
		sockets: existingSockets(HOST_SOCKETS),
	};
}

/**
 * The sockets that exist, by their real path, each once. `/var/run` is a
 * symlink to `/run` on most distributions, and bwrap cannot mount over a
 * path that only resolves through a symlink, so both spellings collapse to
 * the one real target.
 */
export function existingSockets(candidates: string[]): string[] {
	const found = new Set<string>();
	for (const candidate of candidates) {
		try {
			const real = realpathSync(candidate);
			if (statSync(real).isSocket()) found.add(real);
		} catch {
			// Missing.
		}
	}
	return [...found];
}

function bwrapArgs(
	cwd: string,
	projectRoot: string,
	tmpDir: string,
	spawnCommand: string,
	protectedMounts: ProtectedMount[],
	hostMasks: HostMasks,
): string[] {
	return [
		'--info-fd',
		'3',
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
		...bwrapMaskArgs(hostMasks),
		'--bind',
		projectRoot,
		projectRoot,
		'--bind',
		tmpDir,
		tmpDir,
		...bwrapProtectArgs(protectedMounts),
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
	bwrapUsable?: boolean;
	/** From acquireProtectedMounts(); defaults to the entries that exist. */
	protectedMounts?: ProtectedMount[];
	/** Defaults to /run/user/<uid> and the HOST_SOCKETS that exist. */
	hostMasks?: HostMasks;
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
					[
						input.tmpDir ?? '',
						input.hostTmp ?? '',
						'/tmp',
						'/private/tmp',
					].filter(Boolean),
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

	const discovered = input.bwrapPath === undefined;
	const usable =
		input.bwrapUsable ?? (discovered ? bwrapCanUnshareNet(bwrap) : true);
	if (!usable) {
		return {
			error:
				'OS sandbox is on but bubblewrap cannot create a user namespace. Enable unprivileged user namespaces or unset nanocoder.sandbox.',
		};
	}

	return {
		bin: 'bwrap',
		bwrap,
		args: bwrapArgs(
			cwd,
			projectRoot,
			input.tmpDir ?? '',
			spawnCommand,
			input.protectedMounts ?? existingProtectedMounts(projectRoot),
			input.hostMasks ?? defaultHostMasks(),
		),
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
	const bin = plan.bin === 'bwrap' ? plan.bwrap : '/usr/bin/sandbox-exec';
	// codeql[js/shell-command-built-from-environment] resolved jail binary; argv is not a shell string
	// codeql[js/shell-command-constructed-from-input]
	const proc = spawn(bin, plan.args, {
		...spawnOpts,
		// stdin is closed so commands that wait for input get EOF. fd 3 carries
		// bwrap's --info-fd report.
		stdio:
			plan.bin === 'bwrap'
				? ['ignore', 'pipe', 'pipe', 'pipe']
				: ['ignore', 'pipe', 'pipe'],
	});
	if (plan.bin === 'bwrap') {
		let info = '';
		const report = proc.stdio[3];
		report?.on('data', (chunk: Buffer) => {
			info += chunk.toString();
			const pid = info.match(/"child-pid":\s*(\d+)/)?.[1];
			if (pid) commandGroups.set(proc, Number(pid));
		});
		report?.on('error', () => {
			// No report: the executor still signals bwrap's own group.
		});
	}
	return proc;
}
