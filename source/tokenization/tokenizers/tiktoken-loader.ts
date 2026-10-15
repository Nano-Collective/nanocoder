import {createRequire} from 'node:module';

type TiktokenModule = typeof import('tiktoken');

const require = createRequire(import.meta.url);
let cached: TiktokenModule | undefined;

/** Load tiktoken on first use instead of at module import time. */
export function loadTiktoken(): TiktokenModule {
	cached ??= require('tiktoken') as TiktokenModule;
	return cached;
}
