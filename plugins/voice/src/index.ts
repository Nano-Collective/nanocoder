export {
	checkDependenciesInstalled,
	type DependencyCheckResult,
	type InstallDependenciesOptions,
	installDependencies,
} from './dependencies.js';
export {recordAudio} from './microphone.js';
export {playPhrase} from './play-phrase.js';
export {playAudio} from './speaker.js';
export {transcribeAudio} from './stt.js';
export {synthesizeSpeech} from './tts.js';
export {
	createVadEngine,
	VadEngine,
	type VadEngineOptions,
} from './vad.js';
