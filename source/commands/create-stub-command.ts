import React from 'react';
import type {Command} from '@/types/commands';

/**
 * Creates a stub command that is handled specially elsewhere (app.tsx / app-util.ts).
 * The handler returns an empty fragment — actual logic lives in the app layer
 * where full state context is available.
 */
export function createStubCommand(name: string, description: string): Command {
	return {
		name,
		description,
		handler: () => Promise.resolve(React.createElement(React.Fragment)),
	};
}
