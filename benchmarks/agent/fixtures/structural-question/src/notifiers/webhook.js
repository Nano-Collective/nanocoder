export function sendWebhook(url, payload) {
	return {channel: 'webhook', url, payload};
}

// Not a sender: validates configuration.
export function isValidWebhookUrl(url) {
	return url.startsWith('https://');
}
