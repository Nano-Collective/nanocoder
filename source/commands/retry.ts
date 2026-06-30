import type {Command} from '@/types/commands';
import {createStubCommand} from './create-stub-command';

export const retryCommand: Command = createStubCommand(
	'retry',
	'Re-run the last user turn (use --model <id> to switch models first)',
);
