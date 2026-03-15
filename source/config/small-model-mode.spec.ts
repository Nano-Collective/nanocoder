import test from 'ava';
import { isSmallModel } from './index.js';
import { simplifyToolSchema } from '../ai-sdk-client/chat/chat-handler.js';

test('isSmallModel - identifies small models correctly', t => {
    t.true(isSmallModel('llama3.2:1b'));
    t.true(isSmallModel('llama-3.2-3b-instruct'));
    t.true(isSmallModel('gemma-2b'));
    t.true(isSmallModel('phi-3'));
    t.true(isSmallModel('qwen2.5-coder:1.5b'));
    t.true(isSmallModel('mistral-7b-v0.1'));
    t.true(isSmallModel('deepseek-coder-1.3b-instruct'));
    
    t.false(isSmallModel('gpt-4o'));
    t.false(isSmallModel('claude-3-5-sonnet'));
    t.false(isSmallModel('llama-3.1-70b'));
    t.false(isSmallModel('deepseek-v3'));
});

test('simplifyToolSchema - removes descriptions and examples', t => {
    const complexSchema = {
        type: 'object',
        properties: {
            path: {
                type: 'string',
                description: 'The path to the file',
                example: '/src/main.ts'
            },
            options: {
                type: 'object',
                description: 'Optional settings',
                properties: {
                    recursive: {
                        type: 'boolean',
                        description: 'Whether to recurse',
                        example: true
                    }
                }
            }
        },
        required: ['path']
    };

    const expectedSimplified = {
        type: 'object',
        properties: {
            path: {
                type: 'string'
            },
            options: {
                type: 'object',
                properties: {
                    recursive: {
                        type: 'boolean'
                    }
                }
            }
        },
        required: ['path']
    };

    const actual = simplifyToolSchema(complexSchema);
    t.deepEqual(actual, expectedSimplified);
});

test('simplifyToolSchema - handles arrays', t => {
    const arraySchema = {
        type: 'array',
        items: {
            type: 'string',
            description: 'Item description'
        }
    };

    const expected = {
        type: 'array',
        items: {
            type: 'string'
        }
    };

    t.deepEqual(simplifyToolSchema(arraySchema), expected);
});
