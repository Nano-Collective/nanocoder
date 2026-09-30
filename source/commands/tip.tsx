import type {Command} from '@/types/index';
import {infoMsg} from '@/utils/message-factory';
import {findTips, getRandomTip, pickTip} from '@/utils/tips';

// Remembered across invocations so running /tip twice in a row does not hand
// back the same line. Module scope is enough: the lazy registry imports this
// module once per session.
let lastTip: string | undefined;

export const tipCommand: Command = {
	name: 'tip',
	description: 'Show a random Nanocoder usage tip',
	handler: async args => {
		const query = args.join(' ').trim();
		const matches = query ? findTips(query) : null;

		if (matches?.length === 0) {
			return infoMsg(
				`No tip mentions "${query}". Run /tip on its own for a random one.`,
				'tip',
			);
		}

		lastTip = matches ? pickTip(matches) : getRandomTip(Math.random, lastTip);
		return infoMsg(`Tip: ${lastTip}`, 'tip');
	},
};
