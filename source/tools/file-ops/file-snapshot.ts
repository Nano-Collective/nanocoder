import {open, realpath, stat} from 'node:fs/promises';
import {
	hasFileSnapshot,
	matchesFileSnapshot,
} from '@/tools/runtime/read-tracker';

/** Confirm cached edit input still matches the exact file read from disk. */
export async function matchesCurrentFileContent(
	absPath: string,
	expectedContent: string,
	expectedTargetPath?: string,
): Promise<boolean> {
	let handle: Awaited<ReturnType<typeof open>> | undefined;
	try {
		if (
			expectedTargetPath !== undefined &&
			(await realpath(absPath)) !== expectedTargetPath
		) {
			return false;
		}

		handle = await open(absPath, 'r');
		const fileStats = await handle.stat();
		const content = await handle.readFile();
		if (content.toString('utf-8') !== expectedContent) return false;

		const pathStats = await stat(absPath);
		if (fileStats.dev !== pathStats.dev || fileStats.ino !== pathStats.ino) {
			return false;
		}
		if (
			expectedTargetPath !== undefined &&
			(await realpath(absPath)) !== expectedTargetPath
		) {
			return false;
		}

		return (
			!hasFileSnapshot(absPath) ||
			matchesFileSnapshot(absPath, content) === true
		);
	} catch {
		return false;
	} finally {
		await handle?.close().catch(() => {});
	}
}
