import assert from 'node:assert/strict';
import {defaultConfig, loadConfig} from '../src/load-config.js';

// A valid file still parses.
assert.deepEqual(loadConfig('config.json'), {theme: 'light', retries: 4});

// A broken file falls back instead of throwing.
assert.deepEqual(loadConfig('broken.json'), defaultConfig);

process.stdout.write('verify: ok\n');
