import * as fs from 'node:fs/promises';
import * as path from 'node:path';

const RUNTIME_ENTRIES = ['/checkpoints/', '/timeline/', '/daemon.*'];

const pending = new Map<string, Promise<void>>();

async function updateGitignore(workspaceRoot: string): Promise<void> {
	const nanocoderDir = path.join(workspaceRoot, '.nanocoder');
	const gitignorePath = path.join(nanocoderDir, '.gitignore');

	await fs.mkdir(nanocoderDir, {recursive: true});

	let content = '';

	try {
		content = await fs.readFile(gitignorePath, 'utf8');
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
			throw error;
		}
	}

	const existingLines = content.split(/\r?\n/).map(line => line.trim());

	const missingEntries = RUNTIME_ENTRIES.filter(entry => {
		const lastRelevantRule = existingLines
			.filter(line => line === entry || line === `!${entry}`)
			.at(-1);

		return lastRelevantRule !== entry;
	});

	if (missingEntries.length === 0) {
		return;
	}

	const separator = content.length > 0 && !content.endsWith('\n') ? '\n' : '';

	await fs.appendFile(
		gitignorePath,
		separator + missingEntries.join('\n') + '\n',
	);
}

export function ensureNanocoderGitignore(workspaceRoot: string): Promise<void> {
	const key = path.resolve(workspaceRoot);

	const previous = pending.get(key) ?? Promise.resolve();

	const current = previous
		.catch(() => undefined)
		.then(() => updateGitignore(key));

	pending.set(key, current);

	void current
		.finally(() => {
			if (pending.get(key) === current) {
				pending.delete(key);
			}
		})
		.catch(() => undefined);

	return current;
}
