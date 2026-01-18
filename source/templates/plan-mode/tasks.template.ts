/**
 * Tasks Template for Plan Mode
 *
 * Created during Final Plan phase.
 * Provides an implementation checklist organized by task type.
 */

import type {TasksTemplateContext} from '@/types/templates';

export function generateTasksTemplate(context: TasksTemplateContext): string {
	const {
		implementationTasks,
		testingTasks,
		documentationTasks,
		deploymentTasks,
	} = context;

	let content = '';

	// Implementation Tasks
	if (implementationTasks.length > 0) {
		content += '## 1. Implementation\n\n';
		for (const task of implementationTasks) {
			content += `- [ ] ${task.taskNumber} ${task.taskDescription}\n`;
		}
		content += '\n';
	}

	// Testing Tasks
	if (testingTasks.length > 0) {
		content += '## 2. Testing\n\n';
		for (const task of testingTasks) {
			content += `- [ ] ${task.taskNumber} ${task.taskDescription}\n`;
		}
		content += '\n';
	}

	// Documentation Tasks
	if (documentationTasks.length > 0) {
		content += '## 3. Documentation\n\n';
		for (const task of documentationTasks) {
			content += `- [ ] ${task.taskNumber} ${task.taskDescription}\n`;
		}
		content += '\n';
	}

	// Deployment Tasks
	if (deploymentTasks.length > 0) {
		content += '## 4. Deployment\n\n';
		for (const task of deploymentTasks) {
			content += `- [ ] ${task.taskNumber} ${task.taskDescription}\n`;
		}
	}

	return content;
}

export default generateTasksTemplate;
