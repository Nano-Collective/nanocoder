import test from 'ava';
import {CALIBRATION_TESTS} from './calibration-tests';

test('CALIBRATION_TESTS contains 3 deterministic benchmark tests', t => {
	t.is(CALIBRATION_TESTS.length, 3);
	t.is(CALIBRATION_TESTS[0].id, 'json_schema');
	t.is(CALIBRATION_TESTS[1].id, 'instruction_following');
	t.is(CALIBRATION_TESTS[2].id, 'tool_syntax_matching');
});

test('json_schema validator passes valid raw JSON', t => {
	const jsonTest = CALIBRATION_TESTS.find(x => x.id === 'json_schema')!;
	const validRaw = '{"status": "ok", "code": 200, "items": ["alpha", "beta"]}';
	const result = jsonTest.validate(validRaw);

	t.true(result.passed);
	t.is(result.score, 100);
});

test('json_schema validator awards partial score for markdown wrapped JSON', t => {
	const jsonTest = CALIBRATION_TESTS.find(x => x.id === 'json_schema')!;
	const markdownWrapped =
		'```json\n{"status": "ok", "code": 200, "items": ["alpha", "beta"]}\n```';
	const result = jsonTest.validate(markdownWrapped);

	t.true(result.passed);
	t.is(result.score, 80);
});

test('json_schema validator fails malformed JSON', t => {
	const jsonTest = CALIBRATION_TESTS.find(x => x.id === 'json_schema')!;
	const result = jsonTest.validate('Sure! Here is the json: { invalid }');

	t.false(result.passed);
	t.is(result.score, 0);
});

test('instruction_following validator passes strictly compliant 3-line output', t => {
	const ifTest = CALIBRATION_TESTS.find(x => x.id === 'instruction_following')!;
	const compliant =
		'- item_one\n- item_two with CALIBRATE token\n- item_three';
	const result = ifTest.validate(compliant);

	t.true(result.passed);
	t.is(result.score, 100);
});

test('instruction_following validator penalizes incorrect line count or misplaced keywords', t => {
	const ifTest = CALIBRATION_TESTS.find(x => x.id === 'instruction_following')!;
	const nonCompliant =
		'Here are the items:\n- item_one CALIBRATE\n- item_two\n- item_three\n- item_four';
	const result = ifTest.validate(nonCompliant);

	t.false(result.passed);
	t.true(result.score < 80);
});

test('tool_syntax_matching validator passes valid XML tool call', t => {
	const xmlTest = CALIBRATION_TESTS.find(
		x => x.id === 'tool_syntax_matching',
	)!;
	const validXml =
		'<tool_call name="read_file"><path>source/app.tsx</path></tool_call>';
	const result = xmlTest.validate(validXml);

	t.true(result.passed);
	t.is(result.score, 100);
});

test('tool_syntax_matching validator penalizes malformed tags', t => {
	const xmlTest = CALIBRATION_TESTS.find(
		x => x.id === 'tool_syntax_matching',
	)!;
	const invalidXml = 'I will call read_file on source/app.tsx for you';
	const result = xmlTest.validate(invalidXml);

	t.false(result.passed);
	t.is(result.score, 0);
});
