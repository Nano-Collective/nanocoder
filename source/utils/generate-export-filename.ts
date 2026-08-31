import fs from 'fs/promises';
import path from 'path';
import type {Message} from '@/types/core';

const MAX_WORDS = 4;
const MAX_SLUG_LENGTH = 40;

function sanitizeSlug(input: string): string {
	return input
		.toLowerCase()
		.replace(/[^\w\s-]/g, '')
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

export async function uniqueFilename(filepath: string): Promise<string> {
	try {
		await fs.access(filepath);
	} catch {
		return filepath;
	}

	const dir = path.dirname(filepath);
	const ext = path.extname(filepath);
	const base = path.basename(filepath, ext);

	for (let i = 2; i < 1000; i++) {
		const candidate = path.join(dir, `${base}-${i}${ext}`);
		try {
			await fs.access(candidate);
		} catch {
			return candidate;
		}
	}

	return filepath;
}

export function generateExportFilename(messages: Message[]): string {
	const slug = generateSlugFromMessages(messages);
	const date = new Date().toISOString().split('T')[0];

	if (!slug) {
		return `nanocoder-chat-${date}.md`;
	}

	return `${slug}-${date}.md`;
}
