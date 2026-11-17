import {ensureString, isPlainObject} from '@/utils/type-helpers';

// Decoded size of base64 data, without decoding it. Tolerates a data URL
// prefix and line breaks, which some servers send against the spec.
function base64ByteLength(data: string): number {
	const base64 = data.replace(/^data:[^,]*,/, '').replace(/\s/g, '');
	const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0;
	return Math.max(0, Math.floor((base64.length * 3) / 4) - padding);
}

// Text for one MCP content block. Binary data is summarised, not dumped,
// so base64 never reaches the model as text.
function formatContentBlock(block: unknown): string {
	if (!isPlainObject(block)) {
		return JSON.stringify(block);
	}
	switch (block.type) {
		case 'text':
			return ensureString(block.text);
		case 'image':
		case 'audio': {
			const data = ensureString(block.data);
			const mimeType = ensureString(block.mimeType) || block.type;
			return `[${mimeType}, ${base64ByteLength(data)} bytes]`;
		}
		case 'resource': {
			const resource = isPlainObject(block.resource) ? block.resource : {};
			if (typeof resource.text === 'string') {
				// Keep the URI so texts from different resources stay apart.
				return `[resource ${ensureString(resource.uri)}]\n${resource.text}`;
			}
			const parts = [`resource ${ensureString(resource.uri)}`];
			if (typeof resource.mimeType === 'string') {
				parts.push(resource.mimeType);
			}
			if (typeof resource.blob === 'string') {
				parts.push(`${base64ByteLength(resource.blob)} bytes`);
			}
			return `[${parts.join(', ')}]`;
		}
		case 'resource_link':
			return `[resource link: ${ensureString(block.uri)}]`;
		default:
			return JSON.stringify(block);
	}
}

// Join every content block of a tool result, in order.
export function formatToolResultContent(content: unknown[]): string {
	return content.map(formatContentBlock).join('\n');
}
