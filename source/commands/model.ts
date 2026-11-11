import {createStubCommand} from '@/commands/create-stub-command';

export const modelCommand = createStubCommand(
	'model',
	"Select a model from any configured provider (/model browse to search OpenRouter's model list)",
);
