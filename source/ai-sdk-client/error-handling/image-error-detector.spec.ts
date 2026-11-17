import test from 'ava';
import {APICallError} from 'ai';
import {isImageSupportError} from './image-error-detector.js';

test('detects llama.cpp refusing image input without an mmproj', t => {
	t.true(
		isImageSupportError(
			new Error(
				'image input is not supported - hint: if this is unexpected, you may need to provide the mmproj',
			),
		),
	);
});

test('detects LM Studio, vLLM and OpenAI image refusals', t => {
	t.true(isImageSupportError(new Error('Model does not support images.')));
	t.true(isImageSupportError(new Error('qwen2.5-coder is not a multimodal model')));
	t.true(
		isImageSupportError(
			new Error('Invalid content type. image_url is only supported by certain models.'),
		),
	);
});

test('reads the response body of an APICallError', t => {
	const error = new APICallError({
		message: 'Internal Server Error',
		url: 'http://localhost:8080/v1/chat/completions',
		requestBodyValues: {},
		statusCode: 500,
		responseBody: '{"error":{"message":"image input is not supported"}}',
	});
	t.true(isImageSupportError(error));
});

test('finds the refusal in a wrapped cause or a streamed error', t => {
	const wrapped = new Error('No output generated', {
		cause: new Error('this model does not support image input'),
	});
	t.true(isImageSupportError(wrapped));
	t.true(
		isImageSupportError(new Error('No output generated'), [
			new Error('vision is not enabled for this model'),
		]),
	);
});

test('ignores unrelated errors', t => {
	t.false(isImageSupportError(new Error('400 Bad Request: tools not supported')));
	t.false(isImageSupportError(new Error('image too large, max 20MB')));
	t.false(isImageSupportError('nope'));
	t.false(isImageSupportError(undefined));
});
