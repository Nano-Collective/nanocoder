import {createStubCommand} from '@/commands/create-stub-command';

export const tuneCommand = createStubCommand(
	'tune',
	'[deprecated — use /settings → Advanced → Tune Model] Tune model settings (parameters, tool profiles, prompt, compaction)',
);
