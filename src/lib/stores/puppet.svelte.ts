import { browser } from '$app/environment';

export type PuppetStatus = 'disabled' | 'connecting' | 'connected' | 'reconnecting' | 'error';

export interface PuppetMessage {
	type: 'chat';
	text: string;
	name?: string;
}

interface PuppetSettings {
	enabled: boolean;
	url: string;
}

const STORAGE_KEY = 'utsuwa-aicommentviewer-puppet';
const DEFAULT_SETTINGS: PuppetSettings = {
	enabled: false,
	url: 'ws://127.0.0.1:8767/ws?room=lobby&name=Utsuwa'
};

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
						listener?.({ type: 'chat', text: parsed.text, name: parsed.name });
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

	function start(onMessage: (message: PuppetMessage) => void) {
		listener = onMessage;
		if (settings.enabled) connect();
		return () => {
			listener = null;
			disconnect();
		};
	}

	return {
		get enabled() { return settings.enabled; },
		get url() { return settings.url; },
		get status() { return status; },
		get lastError() { return lastError; },
		setEnabled,
		setUrl,
		connect,
		disconnect,
		start
	};
}

export const puppetStore = createPuppetStore();
