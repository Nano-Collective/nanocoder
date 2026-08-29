import test from 'ava';
import {maskApiKey} from './whoami';

test('maskApiKey hides middle characters', t => {
	t.is(maskApiKey('sk-1234567890abcdef'), 'sk-1...cdef');
	t.is(maskApiKey('short'), '********');
	t.is(maskApiKey(), 'Not set');
	t.is(maskApiKey('dummy-key'), 'Not set');
});
