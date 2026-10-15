export function log(message) {
	process.stdout.write(`info: ${message}\n`);
}

export function logError(message) {
	process.stderr.write(`error: ${message}\n`);
}
