export { recordAudio } from './microphone.js';
export { playAudio } from './speaker.js';
export { transcribeAudio } from './stt.js';
export { synthesizeSpeech } from './tts.js';
export { playPhrase } from './play-phrase.js';
export {
	checkDependenciesInstalled,
	installDependencies,
	type DependencyCheckResult,
	type InstallDependenciesOptions,
} from './dependencies.js';
export {
	VadEngine,
	createVadEngine,
	type VadEngineOptions,
} from './vad.js';
