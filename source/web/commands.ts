interface WebCommandHandlers {
	resetSession: () => Promise<void>;
	getSettings: () => {provider: string; model: string; mode: string};
	notice: (message: string) => void;
}

/** Browser commands must never silently open an Ink-only interaction. */
export async function handleWebCommand(
	text: string,
	handlers: WebCommandHandlers,
): Promise<boolean> {
	const trimmed = text.trim();
	if (!trimmed.startsWith('/') && !trimmed.startsWith('!')) return false;
	const command = trimmed.split(/\s+/)[0].toLowerCase();
	if (command === '/clear') {
		await handlers.resetSession();
	} else if (command === '/status') {
		const settings = handlers.getSettings();
		handlers.notice(
			`Provider: ${settings.provider}\nModel: ${settings.model}\nMode: ${settings.mode}`,
		);
	} else if (command === '/model' || command === '/settings') {
		handlers.notice(
			'Open Settings using the gear button to change the provider, model or development mode.',
		);
	} else if (command === '/help') {
		handlers.notice(
			'Web commands: /clear, /status, /model, /settings, /help. Use the sidebar to load or delete sessions.',
		);
	} else {
		throw new Error(
			`The ${command} command is not available in web mode. Run it in the terminal.`,
		);
	}
	return true;
}
