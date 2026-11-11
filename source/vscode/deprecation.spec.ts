import test from 'ava';
import {
	LEGACY_VSCODE_DEPRECATION_NOTICE,
	resetLegacyVscodeDeprecationNoticeForTests,
	takeLegacyVscodeDeprecationNotice,
} from './deprecation';

test.beforeEach(() => {
	resetLegacyVscodeDeprecationNoticeForTests();
});

test('the deprecation notice is given once per process', t => {
	t.is(takeLegacyVscodeDeprecationNotice(), LEGACY_VSCODE_DEPRECATION_NOTICE);
	t.is(takeLegacyVscodeDeprecationNotice(), null);
	t.is(takeLegacyVscodeDeprecationNotice(), null);
});

test('the notice names the flag, says it will be removed, and points at the extension', t => {
	t.regex(LEGACY_VSCODE_DEPRECATION_NOTICE, /--vscode/);
	t.regex(LEGACY_VSCODE_DEPRECATION_NOTICE, /deprecated/);
	t.regex(LEGACY_VSCODE_DEPRECATION_NOTICE, /removed in a future release/);
	t.regex(LEGACY_VSCODE_DEPRECATION_NOTICE, /Nanocoder sidebar/);
});
