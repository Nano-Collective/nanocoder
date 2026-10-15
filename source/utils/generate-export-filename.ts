import type {Message} from '@/types/core';

const MAX_WORDS = 4;
const MAX_SLUG_LENGTH = 40;

function sanitizeSlug(input: string): string {
	return input
		.toLowerCase()
		.replace(/[^\p{L}\p{N}\s-]/gu, '')
		.replace(/\s+/g, '-')
		.replace(/-+/g, '-')
		.replace(/^-|-$/g, '');
}

function truncateAtWordBoundary(slug: string, maxLength: number): string {
	if (slug.length <= maxLength) {
		return slug;
	}

	const truncated = slug.substring(0, maxLength);
	const lastHyphen = truncated.lastIndexOf('-');
	return lastHyphen > 0 ? truncated.substring(0, lastHyphen) : truncated;
}

function generateSlugFromMessages(messages: Message[]): string {
	const firstUserMessage = messages.find(m => m.role === 'user');
	if (!firstUserMessage?.content) {
		return '';
	}

	const lines = firstUserMessage.content.split('\n');
	let firstLine = '';
	for (const line of lines) {
		const trimmed = line.trim();
		if (trimmed) {
			firstLine = trimmed;
			break;
		}
	}

	if (!firstLine) {
		return '';
	}

	const words = firstLine.split(/\s+/).filter(Boolean);
	const truncated = words.slice(0, MAX_WORDS).join(' ');
	return truncateAtWordBoundary(sanitizeSlug(truncated), MAX_SLUG_LENGTH);
}

export function generateExportFilename(messages: Message[]): string {
	const slug = generateSlugFromMessages(messages);
	// Deliberately UTC, not local: the date is only there to disambiguate
	// exports, and a UTC stamp keeps a session that crosses local midnight (or
	// is exported from a different timezone than it was recorded in) ordering
	// consistently. Collisions within the same day are handled by
	// writeUniqueFile, so a local date would buy nothing.
	const date = new Date().toISOString().split('T')[0];

	if (!slug) {
		return `nanocoder-chat-${date}.md`;
	}

	return `${slug}-${date}.md`;
}
