// Display-only: split a command on top-level ; for readability (execution untouched).
export function splitCommandForDisplay(command: string): string[] {
	if (command.trim().length === 0) return [command];
	if (/<<|\b(?:for|while|until|if|case|select)\b/.test(command)) {
		return [command];
	}

	const segments: string[] = [];
	let current = '';
	let quote: '"' | "'" | null = null;
	let backtick = false;
	let depth = 0;

	for (let i = 0; i < command.length; i++) {
		const ch = command[i];
		if (ch === '\\' && quote !== "'") {
			current += ch + (command[++i] ?? '');
		} else if (quote) {
			current += ch;
			if (ch === quote) quote = null;
		} else if (backtick) {
			current += ch;
			if (ch === '`') backtick = false;
		} else if (ch === '"' || ch === "'") {
			quote = ch;
			current += ch;
		} else if (ch === '`') {
			backtick = true;
			current += ch;
		} else if (ch === '(' || ch === '{') {
			depth++;
			current += ch;
		} else if ((ch === ')' || ch === '}') && depth > 0) {
			depth--;
			current += ch;
		} else if (ch === ';' && depth === 0) {
			segments.push(current);
			current = '';
		} else {
			current += ch;
		}
	}

	if (quote || backtick || depth > 0) return [command];
	segments.push(current);

	return segments
		.map((segment, i) =>
			i < segments.length - 1 ? `${segment.trim()};` : segment.trim(),
		)
		.filter(line => line.length > 0);
}
