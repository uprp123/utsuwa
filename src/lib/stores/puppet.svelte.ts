import { browser } from '$app/environment';

export type PuppetStatus = 'disabled' | 'connecting' | 'connected' | 'reconnecting' | 'error';

export interface PuppetChatMessage {
	type: 'chat';
	text: string;
	name?: string;
	emotion?: string;
	motion?: string;
	message_id?: string;
}
export interface PuppetControlMessage {
	type: 'character_control';
	action: 'enter' | 'exit' | 'thinking_start' | 'thinking_stop';
	message_id?: string;
}
export interface PuppetCapabilitiesRequest { type: 'capabilities_request'; request_id?: string; }
export type PuppetMessage = PuppetChatMessage | PuppetControlMessage | PuppetCapabilitiesRequest;
export interface EmotionVoiceStyle { style: string; weight: number; }

interface PuppetSettings {
	enabled: boolean;
	url: string;
	defaultVoiceStyle: string;
	defaultVoiceStyleWeight: number;
	emotionVoiceStyles: Record<string, EmotionVoiceStyle>;
}

const STORAGE_KEY = 'utsuwa-aicommentviewer-puppet';
const DEFAULT_SETTINGS: PuppetSettings = {
	enabled: false,
	url: 'ws://127.0.0.1:8768/ws?room=lobby&name=Utsuwa',
	defaultVoiceStyle: '03',
	defaultVoiceStyleWeight: 0.8,
	emotionVoiceStyles: {}
};

const LEGACY_UTSUWA_URLS = new Set([
	'ws://127.0.0.1:8767/ws?room=lobby&name=Utsuwa',
	'ws://localhost:8767/ws?room=lobby&name=Utsuwa'
]);

function createPuppetStore() {
	let settings = $state<PuppetSettings>({ ...DEFAULT_SETTINGS });
	let status = $state<PuppetStatus>('disabled');
	let lastError = $state<string | null>(null);
	let socket: WebSocket | null = null;
	let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
	let reconnectDelay = 1000;
	let listener: ((message: PuppetMessage) => void) | null = null;

	if (browser) {
		const saved = localStorage.getItem(STORAGE_KEY);
		if (saved) {
			try {
				settings = { ...DEFAULT_SETTINGS, ...JSON.parse(saved) };
				if (LEGACY_UTSUWA_URLS.has(settings.url)) {
					settings.url = DEFAULT_SETTINGS.url;
					localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
				}
			} catch {
				// Keep safe defaults when old settings are malformed.
			}
		}
	}

	function save() {
		if (browser) localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
	}

	function clearReconnect() {
		if (reconnectTimer) clearTimeout(reconnectTimer);
		reconnectTimer = null;
	}

	function disconnect(nextStatus: PuppetStatus = 'disabled') {
		clearReconnect();
		const current = socket;
		socket = null;
		if (current) {
			current.onclose = null;
			current.close();
		}
		status = nextStatus;
	}

	function scheduleReconnect() {
		if (!settings.enabled || reconnectTimer) return;
		status = 'reconnecting';
		reconnectTimer = setTimeout(() => {
			reconnectTimer = null;
			connect();
		}, reconnectDelay);
		reconnectDelay = Math.min(reconnectDelay * 2, 10000);
	}

	function connect() {
		if (!browser || !settings.enabled) return;
		disconnect('connecting');
		lastError = null;
		try {
			const ws = new WebSocket(settings.url);
			socket = ws;
			ws.onopen = () => {
				if (socket !== ws) return;
				status = 'connected';
				reconnectDelay = 1000;
			};
			ws.onmessage = (event) => {
				try {
					const parsed = JSON.parse(String(event.data)) as Partial<PuppetMessage>;
					if (parsed.type === 'chat' && typeof parsed.text === 'string' && parsed.text.trim()) {
						listener?.({
							type: 'chat', text: parsed.text, name: parsed.name,
							emotion: parsed.emotion, motion: parsed.motion, message_id: parsed.message_id
						});
					} else if (parsed.type === 'character_control' &&
						['enter', 'exit', 'thinking_start', 'thinking_stop'].includes(String(parsed.action))) {
						listener?.({
							type: 'character_control',
							action: parsed.action as PuppetControlMessage['action'],
							message_id: parsed.message_id
						});
					} else if (parsed.type === 'capabilities_request') {
						listener?.({ type: 'capabilities_request', request_id: String(parsed.request_id ?? '') });
					}
				} catch {
					lastError = 'Unsupported WebSocket message received';
				}
			};
			ws.onerror = () => {
				if (socket === ws) lastError = `Could not connect to ${settings.url}`;
			};
			ws.onclose = () => {
				if (socket !== ws) return;
				socket = null;
				scheduleReconnect();
			};
		} catch (error) {
			lastError = error instanceof Error ? error.message : 'Invalid WebSocket URL';
			status = 'error';
			scheduleReconnect();
		}
	}

	function setEnabled(enabled: boolean) {
		settings.enabled = enabled;
		settings = { ...settings };
		save();
		if (enabled) connect();
		else disconnect();
	}

	function setUrl(url: string) {
		settings.url = url.trim();
		settings = { ...settings };
		save();
		if (settings.enabled) connect();
	}

	function sendEvent(type: string, messageId?: string) {
		if (!socket || socket.readyState !== WebSocket.OPEN || !messageId) return false;
		socket.send(JSON.stringify({ type, message_id: messageId }));
		return true;
	}

	function sendMessage(message: Record<string, unknown>) {
		if (!socket || socket.readyState !== WebSocket.OPEN) return false;
		socket.send(JSON.stringify(message));
		return true;
	}

	function setVoiceDefaults(style: string, weight: number) {
		settings.defaultVoiceStyle = style.trim() || 'Neutral';
		settings.defaultVoiceStyleWeight = Math.max(0, Math.min(2, Number(weight) || 0));
		settings = { ...settings }; save();
	}

	function setEmotionVoiceStyle(emotion: string, style: string, weight: number) {
		const key = emotion.trim().toLowerCase();
		if (!key) return;
		const next = { ...settings.emotionVoiceStyles };
		if (style.trim()) next[key] = { style: style.trim(), weight: Math.max(0, Math.min(2, Number(weight) || 0)) };
		else delete next[key];
		settings.emotionVoiceStyles = next;
		settings = { ...settings }; save();
	}

	function resolveVoiceStyle(emotion?: string): EmotionVoiceStyle {
		return settings.emotionVoiceStyles[String(emotion ?? '').trim().toLowerCase()] ?? {
			style: settings.defaultVoiceStyle, weight: settings.defaultVoiceStyleWeight
		};
	}

	function start(onMessage: (message: PuppetMessage) => void) {
		listener = onMessage;
		if (settings.enabled) connect();
		return () => {
			if (listener === onMessage) listener = null;
		};
	}

	return {
		get enabled() { return settings.enabled; },
		get url() { return settings.url; },
		get status() { return status; },
		get lastError() { return lastError; },
		get defaultVoiceStyle() { return settings.defaultVoiceStyle; },
		get defaultVoiceStyleWeight() { return settings.defaultVoiceStyleWeight; },
		get emotionVoiceStyles() { return settings.emotionVoiceStyles; },
		setEnabled,
		setUrl,
		sendEvent,
		sendMessage,
		setVoiceDefaults,
		setEmotionVoiceStyle,
		resolveVoiceStyle,
		connect,
		disconnect,
		start
	};
}

export const puppetStore = createPuppetStore();
