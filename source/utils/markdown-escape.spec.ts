import test from 'ava';

import {escapeMarkdown} from './markdown-escape.js';

test('escapeMarkdown escapes markdown special characters', t => {
	t.is(escapeMarkdown('Hello *world*'), 'Hello \\*world\\*');
	t.is(escapeMarkdown('Hello _world_'), 'Hello \\_world\\_');
	t.is(escapeMarkdown('Hello `world`'), 'Hello \\`world\\`');
	t.is(
		escapeMarkdown('[Link](http://example.com)'),
		'\\[Link\\](http://example.com)',
	);
	t.is(escapeMarkdown('Hello <world>'), 'Hello \\<world\\>');
	t.is(escapeMarkdown('Hello # world'), 'Hello \\# world');
	t.is(escapeMarkdown('Hello | world'), 'Hello \\| world');
	t.is(escapeMarkdown('Hello \\ world'), 'Hello \\\\ world');
	t.is(escapeMarkdown('Hello ~world~'), 'Hello \\~world\\~');
});
