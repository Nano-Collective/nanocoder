import type {ContentBlock} from '@agentclientprotocol/sdk';

export function acpContentToUserText(prompt: ContentBlock[]): string {
	let text = '';
	for (const block of prompt) {
		if (block.type === 'text') {
			text += block.text;
		}
	}
	return text;
}
