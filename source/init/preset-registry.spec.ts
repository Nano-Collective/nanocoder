import test from 'ava';
import {
	resolvePreset,
	supportedPresetNames,
	UnknownPresetError,
} from '@/init/preset-registry';

test('preset registry exposes the supported preset names', t => {
	t.deepEqual(supportedPresetNames, ['react', 'nextjs', 'rust']);
});

for (const name of supportedPresetNames) {
	test(`preset registry resolves ${name}`, t => {
		const preset = resolvePreset(name);
		t.is(preset.name, name);
		t.true(preset.files.some(file => file.path === '.nanocoderignore'));
		t.true(
			preset.files.some(file => file.path === '.nanocoder/commands/check.md'),
		);
	});
}

test('preset registry reports unknown presets and all supported names', t => {
	const error = t.throws(() => resolvePreset('vue'));
	t.true(error instanceof UnknownPresetError);
	t.is(
		error.message,
		'Unknown preset "vue". Supported presets: react, nextjs, rust.',
	);
});
