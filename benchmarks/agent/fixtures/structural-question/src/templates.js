// Outside src/notifiers/, so this sender-shaped helper is not part of the
// answer even though its name looks like one.
export function renderTemplate(template) {
	return `<<${template}>>`;
}

export function sendNothing() {
	return null;
}
