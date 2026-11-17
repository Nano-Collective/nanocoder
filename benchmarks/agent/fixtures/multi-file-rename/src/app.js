import {log, logError} from './logger.js';
import {runWorker} from './worker.js';

export function main() {
	log('starting');
	try {
		runWorker(2);
	} catch (error) {
		logError(error.message);
		return 1;
	}
	log('done');
	return 0;
}

main();
