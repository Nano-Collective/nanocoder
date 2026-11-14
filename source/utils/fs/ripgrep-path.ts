let cachedPath: string | undefined;

export async function resolveRipgrepPath(): Promise<string> {
	if (cachedPath) {
		return cachedPath;
	}

	const {rgPath} = await import('@vscode/ripgrep');
	cachedPath = rgPath;
	return cachedPath;
}

export function resetRipgrepPathCache(): void {
	cachedPath = undefined;
}
