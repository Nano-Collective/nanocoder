import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import type {
	AgentSideConnection,
	ContentBlock,
	EmbeddedResource,
	ResourceLink,
} from '@agentclientprotocol/sdk';
import type {ImageAttachment} from '@/types/core';
import {getLogger} from '@/utils/logging';

const logger = getLogger();

/** Image media types the providers accept; others are noted rather than sent. */
const SUPPORTED_IMAGE_MEDIA_TYPES = new Set([
	'image/png',
	'image/jpeg',
	'image/gif',
	'image/webp',
]);

export interface AcpContentContext {
	conn: AgentSideConnection;
	sessionId: string;
	/** Whether the client advertised the `fs.readTextFile` capability. */
	canReadTextFile: boolean;
}

/** A resolved ACP prompt: model-visible text plus any image attachments. */
export interface AcpUserMessage {
	text: string;
	images: ImageAttachment[];
}

/**
 * Convert a prompt's content blocks into the user message the model receives.
 *
 * Text blocks are concatenated directly (preserving the client's own
 * splitting). Embedded resources and `@`-mentioned file links are resolved into
 * readable sections appended after the prompt text. Image blocks are collected
 * as multimodal attachments; audio (and unsupported image types) are noted
 * rather than silently dropped.
 */
export async function acpContentToUserMessage(
	prompt: ContentBlock[],
	ctx?: AcpContentContext,
): Promise<AcpUserMessage> {
	let text = '';
	const sections: string[] = [];
	const images: ImageAttachment[] = [];

	for (const block of prompt) {
		switch (block.type) {
			case 'text':
				text += block.text;
				break;
			case 'resource':
				sections.push(renderEmbeddedResource(block));
				break;
			case 'resource_link':
				sections.push(await renderResourceLink(block, ctx));
				break;
			case 'image': {
				const image = toImageAttachment(block);
				if (image) {
					images.push(image);
				} else {
					sections.push(
						`[Attached image omitted: unsupported media type ${
							'mimeType' in block ? block.mimeType : 'unknown'
						}]`,
					);
				}
				break;
			}
			case 'audio':
				sections.push(
					`[Attached audio omitted: nanocoder cannot process audio content over ACP yet]`,
				);
				break;
			default:
				break;
		}
	}

	const resolvedText =
		sections.length === 0
			? text
			: [text, ...sections].filter(part => part.length > 0).join('\n\n');

	return {text: resolvedText, images};
}

/**
 * Text-only view of {@link acpContentToUserMessage}, kept for callers and tests
 * that only need the model-visible prose.
 */
export async function acpContentToUserText(
	prompt: ContentBlock[],
	ctx?: AcpContentContext,
): Promise<string> {
	return (await acpContentToUserMessage(prompt, ctx)).text;
}

/** Build an image attachment from an ACP image block, or null if unusable. */
function toImageAttachment(block: {
	data?: string;
	mimeType?: string;
}): ImageAttachment | null {
	const {data, mimeType} = block;
	if (!data || !mimeType || !SUPPORTED_IMAGE_MEDIA_TYPES.has(mimeType)) {
		return null;
	}
	return {data, mediaType: mimeType, source: 'acp'};
}

function renderEmbeddedResource(block: EmbeddedResource): string {
	const resource = block.resource;
	if ('text' in resource && typeof resource.text === 'string') {
		return fencedFileContents(resource.uri, resource.text);
	}
	const mime =
		'mimeType' in resource && resource.mimeType ? resource.mimeType : 'unknown';
	return `[Embedded binary resource ${resource.uri} (${mime}) omitted: nanocoder cannot read binary attachments]`;
}

async function renderResourceLink(
	block: ResourceLink,
	ctx?: AcpContentContext,
): Promise<string> {
	const label = block.name || block.uri;
	const path = uriToPath(block.uri);

	if (!path) {
		// Non-file resource (http, etc.) - surface the reference so the model
		// can decide what to do with it rather than dropping it.
		return `[Referenced resource: ${label} (${block.uri})]`;
	}

	// Prefer the client's reader when available: it returns the live editor
	// buffer, including unsaved edits, which is what the user actually sees.
	if (ctx?.canReadTextFile) {
		try {
			const response = await ctx.conn.readTextFile({
				sessionId: ctx.sessionId,
				path,
			});
			return fencedFileContents(path, response.content);
		} catch (error) {
			logger.warn(
				`ACP resource_link: client readTextFile failed for ${path}, falling back to disk: ${String(error)}`,
			);
		}
	}

	try {
		const content = await readFile(path, 'utf8');
		return fencedFileContents(path, content);
	} catch (error) {
		logger.warn(`ACP resource_link: could not read ${path}: ${String(error)}`);
		return `[Could not read referenced file ${label} (${path}): ${String(error)}]`;
	}
}

function uriToPath(uri: string): string | undefined {
	if (uri.startsWith('file://')) {
		try {
			return fileURLToPath(uri);
		} catch {
			return undefined;
		}
	}
	// Some clients send bare absolute paths rather than file URIs.
	if (uri.startsWith('/')) {
		return uri;
	}
	return undefined;
}

function fencedFileContents(uri: string, contents: string): string {
	return `Contents of ${uri}:\n\n\`\`\`\n${contents}\n\`\`\``;
}
