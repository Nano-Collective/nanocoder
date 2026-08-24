import type {Command} from '@/types/index';
import {infoMsg} from '@/utils/message-factory';
import {getRandomTip} from '@/utils/tips';

export const tipCommand: Command = {
	name: 'tip',
	description: 'Show a random Nanocoder usage tip',
	handler: async () => infoMsg(`Tip: ${getRandomTip()}`, 'tip'),
};
