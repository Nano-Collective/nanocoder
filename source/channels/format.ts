/**
 * Split an agent reply into chunks a chat platform will accept.
 *
 * Cuts land on a line break when one exists in the back half of the
 * window, then on a space, then wherever the limit falls. A chunk that
 * ends inside a fenced code block is closed, and the fence is reopened at
 * the top of the next chunk, so platforms that render Markdown (Slack,
 * Discord) never show half a message as code.
 */

const FENCE = '```';

export function splitMessage(text: string, maxLength: number): string[] {
	const limit = Math.max(FENCE.length + 2, Math.floor(maxLength));
	if (text.length <= limit) return [text];

	const chunks: string[] = [];
	let remaining = text;
	let reopenFence = false;

	while (remaining.length > 0) {
		if (reopenFence) remaining = `${FENCE}\n${remaining}`;

		if (remaining.length <= limit) {
			chunks.push(remaining);
			break;
		}

		// Leave room for a closing fence on this chunk.
		const window = remaining.slice(0, limit - FENCE.length - 1);
		let cut = window.lastIndexOf('\n');
		if (cut < window.length / 2) cut = window.lastIndexOf(' ');
		if (cut < window.length / 2) cut = window.length;

		let chunk = remaining.slice(0, cut).trimEnd();
		remaining = remaining.slice(cut).replace(/^[ \n]+/, '');

		reopenFence = countFences(chunk) % 2 === 1;
		if (reopenFence) chunk = `${chunk}\n${FENCE}`;
		if (chunk.length > 0) chunks.push(chunk);
	}

	return chunks;
}

function countFences(chunk: string): number {
	let count = 0;
	for (const line of chunk.split('\n')) {
		if (line.trimStart().startsWith(FENCE)) count++;
	}
	return count;
}
