import {renderTemplate} from '../templates.js';

export function sendEmail(to, template) {
	return {channel: 'email', to, body: renderTemplate(template)};
}

// Not a sender: formats an address for display.
export function formatAddress(to) {
	return to.trim().toLowerCase();
}
