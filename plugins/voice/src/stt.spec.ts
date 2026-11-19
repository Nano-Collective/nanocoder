import test from 'ava';
import {filterSilenceMarkers} from './stt.js';

test('filterSilenceMarkers turns a bare whisper.cpp silence marker into empty text', t => {
	for (const marker of ['[BLANK_AUDIO]', ' [silence] ', '(silence)', '(_BEG_)', '(_END_)']) {
		t.is(filterSilenceMarkers(marker), '', marker);
	}
});

test('filterSilenceMarkers strips stray [BLANK_AUDIO] tokens around speech', t => {
	t.is(filterSilenceMarkers('[BLANK_AUDIO] run the tests [BLANK_AUDIO]'), 'run the tests');
	t.is(filterSilenceMarkers('  hello  '), 'hello');
});
