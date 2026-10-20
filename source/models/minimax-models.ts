/** Current MiniMax text choices for discovery, never for saved model IDs. */
export function filterMiniMaxModels<T extends {id: string}>(
	models: T[],
	baseUrl: string,
): T[] {
	let url: URL;
	try {
		url = new URL(baseUrl);
	} catch {
		return models;
	}

	let current: string[];
	let textModel: RegExp;
	if (['api.minimax.io', 'api.minimax.cn'].includes(url.hostname)) {
		current = ['MiniMax-M3.1-Flash', 'MiniMax-M3'];
		textModel = /^(?:minimax-(?:m\d|(?:text|vl)-01|01)|abab)/i;
	} else if (url.hostname === 'openrouter.ai') {
		current = ['minimax/minimax-m3.1-flash:free', 'minimax/minimax-m3'];
		textModel = /^minimax\/(?:minimax-(?:m\d|(?:text|vl)-01|01)|abab)/i;
	} else if (url.hostname === 'opencode.ai') {
		current = ['minimax-m3.1-flash-free', 'minimax-m3'];
		textModel = /^minimax-(?:m\d|(?:text|vl)-01|01)/i;
	} else {
		return models;
	}

	const filtered = models.filter(
		model => !textModel.test(model.id) || current.includes(model.id),
	);
	const preferred = filtered
		.filter(model => current.includes(model.id))
		.sort((a, b) => current.indexOf(a.id) - current.indexOf(b.id));
	// Reorder only MiniMax slots; retain other providers' order and metadata.
	let index = 0;
	return filtered.map(model =>
		current.includes(model.id) ? preferred[index++] : model,
	);
}
