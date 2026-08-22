import { chatStore } from '$lib/stores/chat.svelte';
import { modulesStore } from '$lib/stores/modules.svelte';
import { settingsStore } from '$lib/stores/settings.svelte';
import { ttsStore } from '$lib/stores/tts.svelte';
import { vrmStore } from '$lib/stores/vrm.svelte';
import { getTTSProvider } from '$lib/services/providers/registry';
import type { TTSProvider } from '$lib/types';

const EMOTION_ALIASES: Record<string, string> = {
	happy: 'happy', joy: 'happy', smile: 'happy',
	angry: 'angry', mad: 'angry',
	sad: 'sad', sorrow: 'sad',
	relaxed: 'relaxed', calm: 'relaxed',
	surprised: 'surprised', surprise: 'surprised'
};

export function parsePuppetText(input: string): { text: string; emotion?: string } {
	const match = input.trim().match(/^\[([^\]]+)]\s*/);
	if (!match) return { text: input.trim() };
	const emotion = EMOTION_ALIASES[match[1].trim().toLowerCase()];
	return { text: input.slice(match[0].length).trim(), emotion };
}

export async function deliverPuppetSpeech(rawText: string): Promise<string> {
	const { text, emotion } = parsePuppetText(rawText);
	if (!text) return '';

	chatStore.addMessage('assistant', text);
	vrmStore.startTalking(text);
	if (emotion) vrmStore.flashExpression(emotion, 0.75, 3500);

	const speechState = modulesStore.getModuleState('speech');
	const speechSettings = modulesStore.getModuleSettings('speech');
	if (speechState?.enabled) {
		const provider = speechSettings.activeProvider as TTSProvider;
		const providerConfig = settingsStore.getProviderConfig(provider);
		const metadata = getTTSProvider(provider);
		await ttsStore.speak(text, {
			provider,
			apiKey: providerConfig.apiKey,
			voiceId: (speechSettings.activeVoiceId as string) || providerConfig.voiceId,
			model: (speechSettings.activeModel as string) || providerConfig.modelId,
			baseUrl: providerConfig.baseUrl || metadata?.defaultBaseUrl,
			speed: (speechSettings.speed as number) ?? 1,
			language: (speechSettings.activeLanguage as string) || undefined,
			instructions: (speechSettings.instructions as string) || undefined,
			numStep: (speechSettings.numStep as number) ?? undefined,
			positionTemperature: (speechSettings.positionTemperature as number) ?? undefined,
			classTemperature: (speechSettings.classTemperature as number) ?? undefined
		});
	}

	return text;
}
