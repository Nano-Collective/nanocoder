import {mkdtempSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'ava';
import {reloadAppConfig} from '@/config/index';
import {isUntrustedContentEscalationEnabled} from './untrusted-content.js';

/**
 * The switch the framing cannot work without: `escalate` decides whether reading
 * a page changes what the next tool call needs. On unless the user opts out.
 */

function withConfig(untrustedContent: unknown): () => void {
	const dir = mkdtempSync(join(tmpdir(), 'nanocoder-untrusted-content-'));
	const previous = process.env.NANOCODER_CONFIG_DIR;
	process.env.NANOCODER_CONFIG_DIR = dir;
	writeFileSync(
		join(dir, 'agents.config.json'),
		JSON.stringify({nanocoder: {untrustedContent}}),
		'utf-8',
	);
	reloadAppConfig();
	return () => {
		if (previous === undefined) {
			delete process.env.NANOCODER_CONFIG_DIR;
		} else {
			process.env.NANOCODER_CONFIG_DIR = previous;
		}
		reloadAppConfig();
	};
}

test.serial('escalation is on when the block is absent', t => {
	const restore = withConfig(undefined);
	try {
		t.true(isUntrustedContentEscalationEnabled());
	} finally {
		restore();
	}
});

test.serial('escalation is on when the block is present but silent', t => {
	const restore = withConfig({});
	try {
		t.true(isUntrustedContentEscalationEnabled());
	} finally {
		restore();
	}
});

test.serial('escalation follows the configured value', t => {
	const on = withConfig({escalate: true});
	try {
		t.true(isUntrustedContentEscalationEnabled());
	} finally {
		on();
	}

	const off = withConfig({escalate: false});
	try {
		t.false(isUntrustedContentEscalationEnabled());
	} finally {
		off();
	}
});

test.serial('a non-boolean value is ignored rather than trusted', t => {
	const restore = withConfig({escalate: 'yes'});
	try {
		t.true(isUntrustedContentEscalationEnabled());
	} finally {
		restore();
	}
});
