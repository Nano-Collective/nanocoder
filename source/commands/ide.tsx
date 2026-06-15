import {createStubCommand} from '@/commands/create-stub-command';

export const ideCommand = createStubCommand(
	'ide',
	'[deprecated — use /settings → Advanced → Connect IDE] Connect to an IDE',
);
