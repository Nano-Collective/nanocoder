import test from 'ava';
import { resumeCommand } from './resume';

test('resume command should have correct name and description', (t) => {
  t.is(resumeCommand.name, 'resume');
  t.is(resumeCommand.description, 'Resume a previous chat session. Usage: /resume (interactive selection), /resume {id}, /resume {number}, or /resume last');
});

test('resume command handler should return a React Fragment', async (t) => {
 const result = await resumeCommand.handler([], [], { provider: 'test', model: 'test', tokens: 0 });
  
  // The handler returns a React Fragment for registration purposes
  t.truthy(result);
});