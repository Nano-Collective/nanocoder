export function sendSlackMessage(channel, text) {
	return {channel: 'slack', target: channel, text};
}
