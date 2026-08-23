import { chatStore } from '$lib/stores/chat.svelte';
import { modulesStore } from '$lib/stores/modules.svelte';
import { settingsStore } from '$lib/stores/settings.svelte';
import { ttsStore } from '$lib/stores/tts.svelte';
import { vrmStore } from '$lib/stores/vrm.svelte';
import { puppetStore } from '$lib/stores/puppet.svelte';
import { getTTSProvider } from '$lib/services/providers/registry';
import type { TTSProvider } from '$lib/types';
import { resolvePuppetExpression, toPuppetExpressionName } from './expressions';

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
	const key = match[1].trim().toLowerCase();
	const emotion = EMOTION_ALIASES[key] ?? key;
	return { text: input.slice(match[0].length).trim(), emotion };
}

export async function deliverPuppetSpeech(
	rawText: string,
	explicitEmotion?: string,
	motion?: string,
	onPlaybackStart?: () => void
): Promise<string> {
	const parsed = parsePuppetText(rawText);
	const text = parsed.text;
	const requestedEmotion = EMOTION_ALIASES[String(explicitEmotion ?? '').toLowerCase()] ?? explicitEmotion ?? parsed.emotion;
	const emotion = resolvePuppetExpression(requestedEmotion, vrmStore.availableExpressions);
	const publicEmotion = emotion ? toPuppetExpressionName(emotion) : undefined;
	const voiceStyle = puppetStore.resolveVoiceStyle(publicEmotion);
	if (!text) return '';

	chatStore.addMessage('assistant', text);
	vrmStore.startTalking(text);
	if (emotion) vrmStore.flashExpression(emotion, vrmStore.expressionSettings.strengths[publicEmotion!] ?? 0.75, 3500);
	if (!motion || motion === 'neutral' || !vrmStore.playMappedMotion(motion)) vrmStore.playNoMotion();

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
			classTemperature: (speechSettings.classTemperature as number) ?? undefined,
			style: voiceStyle.style,
			styleWeight: voiceStyle.weight
		}, onPlaybackStart);
	} else {
		onPlaybackStart?.();
	}

	return text;
}
