import type {Command} from '@/types/commands';
import {errorMsg} from '@/utils/message-factory';

/**
 * Creates a stub command whose real logic lives in the app layer
 * (app-util.ts), where full state context is available. The TUI intercepts
 * these before the registry runs them, so the handler is only ever reached
 * from a surface without that interception (headless / plain). Rather than
 * silently no-op there, it reports that the command needs interactive mode.
 */
export function createStubCommand(name: string, description: string): Command {
	return {
		name,
		description,
		handler: () =>
			Promise.resolve(
				errorMsg(
					`/${name} requires interactive mode. Run nanocoder without --plain to use it.`,
					`${name}-interactive-only`,
				),
			),
	};
}
