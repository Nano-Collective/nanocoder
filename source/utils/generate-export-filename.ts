import fs from 'fs/promises';
import path from 'path';
import type {Message} from '@/types/core';

const MAX_WORDS = 4;
const MAX_SLUG_LENGTH = 40;
const MAX_COLLISION_ATTEMPTS = 5;

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

/**
 * Deterministically finds a free filename for a generated export and writes it
 * atomically.
 *
 * The write uses the exclusive flag 'wx' so the free-check and the create are
 * a single atomic step: two concurrent exports for the same slug can never
 * both succeed on the same path (no TOCTOU race, no clobbering). On EEXIST we
 * try the next collision suffix; once the bounded attempts are exhausted we
 * fall back to a timestamp suffix. This function never falls through to
 * overwriting an existing file.
 *
 * Unlike /export with an explicit filename (which keeps overwrite semantics),
 * generated names must never destroy a previous export.
 */
export async function writeUniqueFile(
	filepath: string,
	content: string,
): Promise<string> {
	const dir = path.dirname(filepath);
	const ext = path.extname(filepath);
	const base = path.basename(filepath, ext);

	const tryWrite = async (candidate: string): Promise<string | null> => {
		try {
			await fs.writeFile(candidate, content, {flag: 'wx'});
			return candidate;
		} catch (error) {
			if (error && typeof error === 'object' && 'code' in error) {
				if (error.code === 'EEXIST') return null;
			}
			throw error;
		}
	};

	for (let i = 1; i < MAX_COLLISION_ATTEMPTS + 1; i++) {
		const suffix = i === 1 ? '' : `-${i}`;
		const candidate = path.join(dir, `${base}${suffix}${ext}`);
		const written = await tryWrite(candidate);
		if (written) return written;
	}

	// Bounded attempts all collided, drop a timestamp and try once more. If the
	// astronomically-unlikely timestamp collision happens, surface the error
	// rather than clobber anything.
	const timestamped = path.join(dir, `${base}-new-${Date.now()}${ext}`);
	return tryWrite(timestamped).then(result => {
		if (!result) {
			throw new Error('Unable to allocate a unique export filename');
		}
		return result;
	});
}

export function generateExportFilename(messages: Message[]): string {
	const slug = generateSlugFromMessages(messages);
	const date = new Date().toISOString().split('T')[0];

	if (!slug) {
		return `nanocoder-chat-${date}.md`;
	}

	return `${slug}-${date}.md`;
}
