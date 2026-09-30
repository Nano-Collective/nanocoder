import test from 'ava';
import {isDerivedContentPath} from './derived-content';

test('isDerivedContentPath - true for converted document formats', t => {
	t.true(isDerivedContentPath('/tmp/spec.pdf'));
	t.true(isDerivedContentPath('/tmp/spec.docx'));
});

test('isDerivedContentPath - extension match is case-insensitive', t => {
	t.true(isDerivedContentPath('/tmp/spec.PDF'));
	t.true(isDerivedContentPath('/tmp/spec.DOCX'));
	t.true(isDerivedContentPath('/tmp/spec.DocX'));
});

test('isDerivedContentPath - false for text the read path returns verbatim', t => {
	t.false(isDerivedContentPath('/tmp/spec.md'));
	t.false(isDerivedContentPath('/tmp/spec.txt'));
	t.false(isDerivedContentPath('/tmp/spec.ts'));
	t.false(isDerivedContentPath('/tmp/LICENSE'));
});

test('isDerivedContentPath - matches the extension, not the rest of the name', t => {
	// A transcript saved beside the document is an ordinary editable file.
	t.false(isDerivedContentPath('/tmp/spec.pdf.md'));
	t.false(isDerivedContentPath('/tmp/pdf-notes.txt'));
	t.false(isDerivedContentPath('/tmp/docx/readme.md'));
});

test('isDerivedContentPath - handles Windows separators', t => {
	t.true(isDerivedContentPath('C:\Users\me\spec.pdf'));
	t.false(isDerivedContentPath('C:\Users\me\spec.md'));
});
