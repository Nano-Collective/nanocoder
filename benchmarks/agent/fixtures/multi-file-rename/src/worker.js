import {log} from './logger.js';

export function runWorker(batches) {
	for (let batch = 1; batch <= batches; batch++) {
		log(`batch ${batch}`);
	}
}
