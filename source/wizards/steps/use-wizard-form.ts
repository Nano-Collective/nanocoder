import {useState} from 'react';
import type {TemplateField} from '../templates/provider-templates';

/**
 * Shared field-entry state machine for the provider and MCP setup wizards.
 *
 * Both steps walk a selected template's `fields` one at a time, collecting
 * answers and rebuilding `currentValue` from the answer-or-default each time
 * the active field changes. This hook owns that common state plus the
 * mechanical transitions; the steps keep their own divergent logic (model
 * fetching, multiline input, tabs, validation, build/persist).
 *
 * Navigation helpers take the template + answers explicitly rather than
 * reading hook state, so callers never depend on a stale closure of either.
 */

/** Resolve the input value for a field: prior answer, else default, else ''. */
function valueForField(
	field: TemplateField | undefined,
	answers: Record<string, string>,
): string {
	return answers[field?.name ?? ''] || field?.default || '';
}

export interface WizardFormTemplate {
	name: string;
	fields: TemplateField[];
}

export function useWizardForm<T extends WizardFormTemplate>() {
	const [selectedTemplate, setSelectedTemplate] = useState<T | null>(null);
	const [currentFieldIndex, setCurrentFieldIndex] = useState(0);
	const [fieldAnswers, setFieldAnswers] = useState<Record<string, string>>({});
	const [currentValue, setCurrentValue] = useState('');
	const [error, setError] = useState<string | null>(null);
	// Bumped to force the text input to remount and reset its cursor.
	const [inputKey, setInputKey] = useState(0);

	const currentField = selectedTemplate?.fields[currentFieldIndex];

	/** Begin a template at its first field, seeding answers (default {}). */
	const beginTemplate = (template: T, answers: Record<string, string> = {}) => {
		setSelectedTemplate(template);
		setCurrentFieldIndex(0);
		setFieldAnswers(answers);
		setCurrentValue(valueForField(template.fields[0], answers));
		setError(null);
	};

	/** Move to `index` within `template`, syncing currentValue from answers. */
	const loadField = (
		template: T,
		index: number,
		answers: Record<string, string>,
	) => {
		setCurrentFieldIndex(index);
		setCurrentValue(valueForField(template.fields[index], answers));
	};

	/** Clear all field-entry state (template no longer selected). */
	const resetForm = () => {
		setSelectedTemplate(null);
		setCurrentFieldIndex(0);
		setFieldAnswers({});
		setCurrentValue('');
		setError(null);
	};

	const bumpInputKey = () => setInputKey(prev => prev + 1);

	return {
		selectedTemplate,
		setSelectedTemplate,
		currentFieldIndex,
		setCurrentFieldIndex,
		fieldAnswers,
		setFieldAnswers,
		currentValue,
		setCurrentValue,
		error,
		setError,
		inputKey,
		currentField,
		beginTemplate,
		loadField,
		resetForm,
		bumpInputKey,
	};
}
