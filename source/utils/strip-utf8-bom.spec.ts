import test from 'ava';
import {stripUtf8Bom} from './strip-utf8-bom.js';

test('stripUtf8Bom removes a leading BOM', t => {
	t.is(stripUtf8Bom('﻿{"a":1}'), '{"a":1}');
});

test('stripUtf8Bom leaves content without a BOM untouched', t => {
	t.is(stripUtf8Bom('{"a":1}'), '{"a":1}');
	t.is(stripUtf8Bom(''), '');
});

test('stripUtf8Bom only strips a BOM at the start', t => {
	t.is(stripUtf8Bom('a﻿b'), 'a﻿b');
});
