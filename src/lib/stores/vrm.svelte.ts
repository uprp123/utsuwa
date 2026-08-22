import { browser } from '$app/environment';
import type { VRM } from '@pixiv/three-vrm';
import localforage from 'localforage';
import { isTauri } from '$lib/services/platform/platform';
import { createTempVrmStoreIntegration } from '$lib/utils/temp-vrm-store';
import type { TouchZone } from '$lib/engine/photo-reactions';

export interface VrmModel {
	id: string;
	name: string;
	url: string;
	previewUrl?: string;
	isDefault: boolean;
	createdAt: number;
}

export interface CustomAnimation {
	id: string;
	name: string;
	url: string;
	createdAt: number;
	loop?: boolean;
	lockFacing?: boolean;
	facingStrength?: number;
}
export interface ExpressionSettings {
	strengths: Record<string, number>; happyBlink: number; fadeIn: number; fadeOut: number;
}
export interface PresenceSettings {
	enterAnimationId: string | null;
	exitAnimationId: string | null;
	fadeSeconds: number;
	autoExitEnabled: boolean;
	autoExitMinutes: number;
}
export type PresenceState = 'present' | 'entering' | 'exiting' | 'hidden';
const DEFAULT_EXPRESSION_SETTINGS: ExpressionSettings = {
	strengths: { happy: .75, sad: .75, angry: .75, surprised: .75, relaxed: .75 },
	happyBlink: .35, fadeIn: .4, fadeOut: .6
};

interface MotionBackupAnimation {
	id: string;
	name: string;
	createdAt: number;
	data: string;
	loop?: boolean;
	lockFacing?: boolean;
	facingStrength?: number;
}

interface MotionBackup {
	format: 'utsuwa-motion-backup';
	version: 1;
	exportedAt: string;
	animations: MotionBackupAnimation[];
	activeIdleAnimationId: string | null;
	activeTalkingAnimationId: string | null;
	randomIdleAnimationIds: string[];
	randomIdleMinSeconds: number;
	randomIdleMaxSeconds: number;
	motionTransitionInSeconds?: number;
	motionTransitionOutSeconds?: number;
	noMotionAnimationId?: string | null;
	noMotionLockFacing?: boolean;
	noMotionFacingStrength?: number;
	motionAssignments: Record<string, string>;
	presenceSettings?: PresenceSettings;
}

export const MOTION_SLOTS = [
	'happy', 'wave', 'clap', 'cheer', 'surprised', 'thinking', 'sad', 'angry', 'bow', 'dance',
	'showcase', 'greeting', 'peace', 'shoot', 'spin', 'model_pose', 'squat'
] as const;
export const NO_MOTION_ASSIGNMENT = '__no_motion__';

// Default models bundled with the app (first one is loaded by default).
// See static/models/README.md for each model's license.
const DEFAULT_MODELS: VrmModel[] = [
	{
		id: 'default-sample-b',
		name: 'Tsuki',
		url: '/models/AvatarSample_B.vrm',
		previewUrl: undefined,
		isDefault: true,
		createdAt: 0
	},
	{
		id: 'default-vita',
		name: 'Yuki',
		url: '/models/Vita.vrm',
		previewUrl: undefined,
		isDefault: true,
		createdAt: 0
	},
	{
		id: 'default-victoria',
		name: 'Momo',
		url: '/models/Victoria_Rubin.vrm',
		previewUrl: undefined,
		isDefault: true,
		createdAt: 0
	}
];

// Bumped when thumbnail generation changes so stale previews regenerate
const PREVIEW_KEY_PREFIX = 'model-preview-v2-';

// Configure localforage for VRM storage
const vrmStorage = browser
	? localforage.createInstance({
			name: 'utsuwa-vrm',
			storeName: 'models'
		})
	: null;

const motionStorage = browser
	? localforage.createInstance({
		name: 'utsuwa-motion',
		storeName: 'animations'
	})
	: null;

function createVrmStore() {
	// Current model state - null until initFromStorage determines the correct model
	let modelUrl = $state<string | null>(null);
	let vrm = $state<VRM | null>(null);
	let isLoading = $state(false);
	let error = $state<string | null>(null);
	let errorTimeout: ReturnType<typeof setTimeout> | null = null;

	// Gallery state
	let models = $state<VrmModel[]>([...DEFAULT_MODELS]);
	let activeModelId = $state<string | null>(DEFAULT_MODELS[0].id);

	// Available expressions on current model (persists across navigation)
	let availableExpressions = $state<string[]>([]);
	let expressionSettings = $state<ExpressionSettings>(structuredClone(DEFAULT_EXPRESSION_SETTINGS));
	let activeExpression = $state<{ name: string; value: number; startedAt: number; durationMs: number; seq: number } | null>(null);
	let expressionSeq = 0;
	function loadExpressionSettings(modelId = activeModelId) {
		if (!browser || !modelId) return;
		try {
			const saved = JSON.parse(localStorage.getItem(`utsuwa-expression-${modelId}`) || 'null');
			expressionSettings = { ...structuredClone(DEFAULT_EXPRESSION_SETTINGS), ...(saved || {}), strengths: { ...DEFAULT_EXPRESSION_SETTINGS.strengths, ...(saved?.strengths || {}) } };
		} catch { expressionSettings = structuredClone(DEFAULT_EXPRESSION_SETTINGS); }
	}
	function updateExpressionSettings(next: ExpressionSettings) {
		expressionSettings = next;
		if (browser && activeModelId) localStorage.setItem(`utsuwa-expression-${activeModelId}`, JSON.stringify(next));
	}
	function clearActiveExpression(seq: number) { if (activeExpression?.seq === seq) activeExpression = null; }

	// ── Temporary model (for Developer Tools preview) ──
	// Kept in memory only; never persisted to storage.
	const tempVrm = createTempVrmStoreIntegration();
	let tempModelActive = $state(false);
	let tempModelLoading = $state(false);
	let tempModelLoadError = $state(false);

	// Reactive bridge between the integration helper and the store's $state.
	const tempState = {
		get modelUrl() {
			return modelUrl;
		},
		set modelUrl(value: string | null) {
			modelUrl = value;
		},
		get activeModelId() {
			return activeModelId;
		},
		set activeModelId(value: string | null) {
			activeModelId = value;
		},
		get availableExpressions() {
			return availableExpressions;
		},
		set availableExpressions(value: string[]) {
			availableExpressions = value;
		},
		get tempModelActive() {
			return tempModelActive;
		},
		set tempModelActive(value: boolean) {
			tempModelActive = value;
		},
		get tempModelLoading() {
			return tempModelLoading;
		},
		set tempModelLoading(value: boolean) {
			tempModelLoading = value;
		},
		get tempModelLoadError() {
			return tempModelLoadError;
		},
		set tempModelLoadError(value: boolean) {
			tempModelLoadError = value;
		}
	};

	// Animation state
	let currentAnimation = $state<string | null>(null);
	let currentAnimationRevision = $state(0);
	let currentAnimationLoop = $state(false);
	let noMotionPlaying = $state(false);
	let thinkingMotionActive = $state(false);
	let thinkingHandoffTimer: ReturnType<typeof setTimeout> | null = null;
	const defaultPresenceSettings: PresenceSettings = {
		enterAnimationId: null, exitAnimationId: null, fadeSeconds: 1,
		autoExitEnabled: false, autoExitMinutes: 30
	};
	let presenceSettings = $state<PresenceSettings>({ ...defaultPresenceSettings });
	let presenceState = $state<PresenceState>('present');
	let pendingPresenceAction: 'enter' | 'exit' | null = null;
	let pendingPresenceAnimationId: string | null = null;
	let lastPresenceActivityAt = Date.now();
	let autoExitSecondsRemaining = $state<number | null>(null);
	const sanitizeFadeSeconds = (value: unknown, fallback = 1) => {
		const parsed = Number(value);
		return Number.isFinite(parsed) ? Math.max(0, Math.min(10, parsed)) : fallback;
	};
	if (browser) {
		try {
			const saved = JSON.parse(localStorage.getItem('utsuwa-presence-settings') || 'null') as Partial<PresenceSettings> | null;
			if (saved) presenceSettings = {
				enterAnimationId: typeof saved.enterAnimationId === 'string' ? saved.enterAnimationId : null,
				exitAnimationId: typeof saved.exitAnimationId === 'string' ? saved.exitAnimationId : null,
				fadeSeconds: sanitizeFadeSeconds(saved.fadeSeconds),
				autoExitEnabled: Boolean(saved.autoExitEnabled),
				autoExitMinutes: Math.max(0.1, Math.min(1440, Number(saved.autoExitMinutes) || 30))
			};
		} catch { presenceSettings = { ...defaultPresenceSettings }; }
	}
	function updatePresenceSettings(next: PresenceSettings) {
		presenceSettings = {
			enterAnimationId: next.enterAnimationId || null,
			exitAnimationId: next.exitAnimationId || null,
			fadeSeconds: sanitizeFadeSeconds(next.fadeSeconds, 0),
			autoExitEnabled: Boolean(next.autoExitEnabled),
			autoExitMinutes: Math.max(0.1, Math.min(1440, Number(next.autoExitMinutes) || 30))
		};
		markPresenceActivity();
		if (browser) localStorage.setItem('utsuwa-presence-settings', JSON.stringify(presenceSettings));
	}
	function markPresenceActivity() {
		lastPresenceActivityAt = Date.now();
		autoExitSecondsRemaining = presenceSettings.autoExitEnabled
			? Math.ceil(presenceSettings.autoExitMinutes * 60)
			: null;
	}
	function finishPresenceAction(action: 'enter' | 'exit') {
		if (pendingPresenceAction !== action) return;
		presenceState = action === 'exit' ? 'hidden' : 'present';
		pendingPresenceAction = null;
		pendingPresenceAnimationId = null;
	}
	function requestPresence(action: 'enter' | 'exit') {
		if (action === 'exit' && (presenceState === 'hidden' || presenceState === 'exiting')) return;
		if (action === 'enter' && (presenceState === 'present' || presenceState === 'entering')) return;
		if (action === 'enter') markPresenceActivity();
		pendingPresenceAction = action;
		presenceState = action === 'exit' ? 'exiting' : 'entering';
		pendingPresenceAnimationId = action === 'exit'
			? presenceSettings.exitAnimationId
			: presenceSettings.enterAnimationId;
		if (pendingPresenceAnimationId) setCurrentAnimation(pendingPresenceAnimationId, false);
		else {
			if (action === 'enter') setCurrentAnimation(null);
			finishPresenceAction(action);
		}
	}
	function notifyAnimationCompleted(animationId: string) {
		const pendingAnimation = availableAnimations.find((item) => item.id === pendingPresenceAnimationId);
		if (pendingPresenceAction && (
			pendingPresenceAnimationId === animationId || pendingAnimation?.url === animationId
		)) finishPresenceAction(pendingPresenceAction);
	}
	if (browser) setInterval(() => {
		if (!presenceSettings.autoExitEnabled || presenceState !== 'present') {
			autoExitSecondsRemaining = null;
			return;
		}
		const timeoutSeconds = presenceSettings.autoExitMinutes * 60;
		autoExitSecondsRemaining = Math.max(0, Math.ceil(timeoutSeconds - (Date.now() - lastPresenceActivityAt) / 1000));
		if (autoExitSecondsRemaining === 0 && !isTalking && !currentAnimation && !thinkingMotionActive) requestPresence('exit');
	}, 1000);

	// Talking animation state (triggered by text output)
	let isTalking = $state(false);
	let talkingTimeout: ReturnType<typeof setTimeout> | null = null;

	// Tap reactions: the scene raycasts a tap into a touch zone and the model
	// component applies the staged reaction. Universal, not photo-mode-only.
	let reactionRequest = $state<{ zone: TouchZone; seq: number } | null>(null);
	let reactionSeq = 0;
	function requestReaction(zone: TouchZone) {
		markPresenceActivity();
		reactionRequest = { zone, seq: ++reactionSeq };
	}

	// Head position for 3D speech bubble positioning
	let headPosition = $state<[number, number, number]>([0, 1.6, 0]);
	// Screen-space position (x, y as percentages 0-100)
	let headScreenPosition = $state<{ x: number; y: number } | null>(null);
	// Default animations
	const idleAnimationUrl = '/animations/idle.vrma';
	let talkingAnimationUrl = $state('/animations/talking.vrma');

	// All idle animations for random cycling
	const builtInIdleAnimationUrls = [
		'/animations/idle.vrma',
		'/animations/idle_2.vrma',
		'/animations/idle_3.vrma',
		'/animations/idle_4.vrma',
		'/animations/idle_5.vrma'
	];
	let idleAnimationUrls = $state<string[]>([...builtInIdleAnimationUrls]);
	let idleAnimationRevision = $state(0);
	let talkingAnimationRevision = $state(0);
	let customAnimations = $state<CustomAnimation[]>([]);
	let activeIdleAnimationId = $state<string | null>(null);
	let activeTalkingAnimationId = $state<string | null>(null);
	let randomIdleAnimationIds = $state<string[]>([]);
	let randomIdleAnimationRevision = $state(0);
	let randomIdleMinSeconds = $state(10);
	let randomIdleMaxSeconds = $state(20);
	let motionTransitionInSeconds = $state(0.6);
	let motionTransitionOutSeconds = $state(0.6);
	let noMotionAnimationId = $state<string | null>(null);
	let noMotionLockFacing = $state(true);
	let noMotionFacingStrength = $state(1);
	const sanitizeMotionTransition = (value: unknown, fallback = 0.6) => {
		const parsed = Number(value);
		return Number.isFinite(parsed) ? Math.max(0.05, Math.min(10, parsed)) : fallback;
	};
	const sanitizeFacingStrength = (value: unknown, fallback = 1) => {
		const parsed = Number(value);
		return Number.isFinite(parsed) ? Math.max(0, Math.min(1, parsed)) : fallback;
	};
	let motionAssignments = $state<Record<string, string>>({});

	// Selectable one-shot emotes (played via the developer tools). These are the
	// VRMA files shipped in static/animations/ that aren't part of the idle cycle
	// or the talking loop.
	const builtInAnimations: Array<{ id: string; name: string; url: string; loop?: boolean }> = [
		{ id: 'default_idle', name: 'デフォルト待機モーション', url: '/animations/idle.vrma', loop: true },
		{ id: 'default_talking', name: 'デフォルト会話モーション', url: '/animations/talking.vrma', loop: true },
		{ id: 'vrma_01', name: '全身を見せる', url: '/animations/VRMA_01.vrma' },
		{ id: 'vrma_02', name: '挨拶', url: '/animations/VRMA_02.vrma' },
		{ id: 'vrma_03', name: 'Vサイン', url: '/animations/VRMA_03.vrma' },
		{ id: 'vrma_04', name: '撃つ', url: '/animations/VRMA_04.vrma' },
		{ id: 'vrma_05', name: '回る', url: '/animations/VRMA_05.vrma' },
		{ id: 'vrma_06', name: 'モデルポーズ', url: '/animations/VRMA_06.vrma' },
		{ id: 'vrma_07', name: '屈伸運動', url: '/animations/VRMA_07.vrma' }
	];
	const defaultMotionAssignments: Record<string, string> = {
		showcase: 'vrma_01', greeting: 'vrma_02', peace: 'vrma_03', shoot: 'vrma_04',
		spin: 'vrma_05', model_pose: 'vrma_06', squat: 'vrma_07'
	};
	let availableAnimations = $state<Array<{ id: string; name: string; url: string; loop?: boolean }>>([
		...builtInAnimations
	]);

	if (browser) void hydrateAnimations();

	async function hydrateAnimations() {
		try {
			const saved = (await motionStorage?.getItem<Array<Omit<CustomAnimation, 'url'>>>(
				'animation-list'
			)) ?? [];
			const restored: CustomAnimation[] = [];
			for (const animation of saved) {
				const blob = await motionStorage?.getItem<Blob>(`animation-blob-${animation.id}`);
				if (blob) restored.push({ ...animation, loop: Boolean(animation.loop), lockFacing: Boolean(animation.lockFacing), facingStrength: sanitizeFacingStrength(animation.facingStrength), url: URL.createObjectURL(blob) });
			}
			customAnimations = restored;
			availableAnimations = [...builtInAnimations, ...restored];
			activeIdleAnimationId =
				(await motionStorage?.getItem<string>('active-idle-animation-id')) ?? null;
			activeTalkingAnimationId =
				(await motionStorage?.getItem<string>('active-talking-animation-id')) ?? null;
			randomIdleAnimationIds =
				(await motionStorage?.getItem<string[]>('random-idle-animation-ids')) ?? [];
			motionAssignments = { ...defaultMotionAssignments,
				...((await motionStorage?.getItem<Record<string, string>>('motion-assignments')) ?? {}) };
			randomIdleMinSeconds = (await motionStorage?.getItem<number>('random-idle-min-seconds')) ?? 10;
			randomIdleMaxSeconds = (await motionStorage?.getItem<number>('random-idle-max-seconds')) ?? 20;
			motionTransitionInSeconds = sanitizeMotionTransition(await motionStorage?.getItem<number>('motion-transition-in-seconds'));
			motionTransitionOutSeconds = sanitizeMotionTransition(await motionStorage?.getItem<number>('motion-transition-out-seconds'));
			noMotionAnimationId = (await motionStorage?.getItem<string>('no-motion-animation-id')) ?? null;
			noMotionLockFacing = (await motionStorage?.getItem<boolean>('no-motion-lock-facing')) ?? true;
			noMotionFacingStrength = sanitizeFacingStrength(await motionStorage?.getItem<number>('no-motion-facing-strength'));
			applyAnimationAssignments();
		} catch (e) {
			console.error('Failed to restore custom animations:', e);
		}
	}

	function applyAnimationAssignments() {
		const idle = customAnimations.find((animation) => animation.id === activeIdleAnimationId);
		idleAnimationUrls = idle
			? [idle.url]
			: [...builtInIdleAnimationUrls];
		const talking = customAnimations.find((animation) => animation.id === activeTalkingAnimationId);
		talkingAnimationUrl = talking?.url ?? '/animations/talking.vrma';
		idleAnimationRevision += 1;
		talkingAnimationRevision += 1;
		randomIdleAnimationRevision += 1;
	}

	async function saveAnimationList() {
		await motionStorage?.setItem(
			'animation-list',
			customAnimations.map(({ id, name, createdAt, loop, lockFacing, facingStrength }) => ({ id, name, createdAt, loop: Boolean(loop), lockFacing: Boolean(lockFacing), facingStrength: sanitizeFacingStrength(facingStrength) }))
		);
	}

	async function addAnimation(file: File): Promise<void> {
		if (!/\.vrma$/i.test(file.name)) throw new Error('Select a .vrma file');
		const id = `custom-motion-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
		const blob = new Blob([await file.arrayBuffer()], { type: 'model/gltf-binary' });
		await motionStorage?.setItem(`animation-blob-${id}`, blob);
		const animation: CustomAnimation = {
			id,
			name: file.name.replace(/\.vrma$/i, ''),
			url: URL.createObjectURL(blob),
			createdAt: Date.now()
			, loop: false, lockFacing: false, facingStrength: 1
		};
		customAnimations = [...customAnimations, animation];
		availableAnimations = [...builtInAnimations, ...customAnimations];
		await saveAnimationList();
	}

	async function blobToDataUrl(blob: Blob): Promise<string> {
		return await new Promise((resolve, reject) => {
			const reader = new FileReader();
			reader.onload = () => resolve(String(reader.result ?? ''));
			reader.onerror = () => reject(reader.error ?? new Error('Failed to read motion data'));
			reader.readAsDataURL(blob);
		});
	}

	function dataUrlToBlob(data: string): Blob {
		const match = data.match(/^data:([^;,]+)?;base64,([A-Za-z0-9+/=]+)$/);
		if (!match) throw new Error('Backup contains invalid motion data');
		const binary = atob(match[2]);
		const bytes = new Uint8Array(binary.length);
		for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
		return new Blob([bytes], { type: match[1] || 'model/gltf-binary' });
	}

	async function exportMotionBackup(): Promise<Blob> {
		const animations: MotionBackupAnimation[] = [];
		for (const animation of customAnimations) {
			const stored = await motionStorage?.getItem<Blob>(`animation-blob-${animation.id}`);
			if (!stored) throw new Error(`Motion file is missing: ${animation.name}`);
			animations.push({
				id: animation.id,
				name: animation.name,
				createdAt: animation.createdAt,
				loop: Boolean(animation.loop),
				lockFacing: Boolean(animation.lockFacing),
				facingStrength: sanitizeFacingStrength(animation.facingStrength),
				data: await blobToDataUrl(stored)
			});
		}
		const backup: MotionBackup = {
			format: 'utsuwa-motion-backup',
			version: 1,
			exportedAt: new Date().toISOString(),
			animations,
			activeIdleAnimationId,
			activeTalkingAnimationId,
			randomIdleAnimationIds: [...randomIdleAnimationIds],
			randomIdleMinSeconds,
			randomIdleMaxSeconds,
			motionTransitionInSeconds,
			motionTransitionOutSeconds,
			noMotionAnimationId,
			noMotionLockFacing,
			noMotionFacingStrength,
			motionAssignments: { ...motionAssignments },
			presenceSettings: { ...presenceSettings }
		};
		return new Blob([JSON.stringify(backup)], { type: 'application/json' });
	}

	async function importMotionBackup(file: File): Promise<number> {
		if (file.size > 250 * 1024 * 1024) throw new Error('Motion backup is too large (maximum 250 MB)');
		let parsed: unknown;
		try {
			parsed = JSON.parse(await file.text());
		} catch {
			throw new Error('Select a valid Utsuwa motion backup file');
		}
		if (!parsed || typeof parsed !== 'object') throw new Error('Invalid motion backup');
		const backup = parsed as Partial<MotionBackup>;
		if (backup.format !== 'utsuwa-motion-backup' || backup.version !== 1 || !Array.isArray(backup.animations)) {
			throw new Error('Unsupported motion backup format');
		}
		if (backup.animations.length > 500) throw new Error('Motion backup contains too many files');

		const seen = new Set<string>();
		const restored: Array<{ metadata: Omit<CustomAnimation, 'url'>; blob: Blob }> = [];
		for (const item of backup.animations) {
			if (!item || typeof item.id !== 'string' || typeof item.name !== 'string' || typeof item.data !== 'string') {
				throw new Error('Motion backup contains an invalid entry');
			}
			const id = item.id.trim();
			if (!id || seen.has(id)) throw new Error('Motion backup contains duplicate motion IDs');
			seen.add(id);
			restored.push({
				metadata: { id, name: item.name.trim() || 'Imported motion', createdAt: Number(item.createdAt) || Date.now(), loop: Boolean(item.loop), lockFacing: Boolean(item.lockFacing), facingStrength: sanitizeFacingStrength(item.facingStrength) },
				blob: dataUrlToBlob(item.data)
			});
		}

		for (const animation of customAnimations) {
			if (animation.url.startsWith('blob:')) URL.revokeObjectURL(animation.url);
			await motionStorage?.removeItem(`animation-blob-${animation.id}`);
		}
		for (const item of restored) await motionStorage?.setItem(`animation-blob-${item.metadata.id}`, item.blob);

		customAnimations = restored.map(({ metadata, blob }) => ({ ...metadata, url: URL.createObjectURL(blob) }));
		availableAnimations = [...builtInAnimations, ...customAnimations];
		const validIds = new Set([...seen, ...builtInAnimations.map((item) => item.id)]);
		const validId = (value: unknown): value is string => typeof value === 'string' && validIds.has(value);
		activeIdleAnimationId = validId(backup.activeIdleAnimationId) ? backup.activeIdleAnimationId : null;
		activeTalkingAnimationId = validId(backup.activeTalkingAnimationId) ? backup.activeTalkingAnimationId : null;
		randomIdleAnimationIds = Array.isArray(backup.randomIdleAnimationIds)
			? [...new Set(backup.randomIdleAnimationIds.filter(validId))]
			: [];
		randomIdleMinSeconds = Math.max(1, Number(backup.randomIdleMinSeconds) || 10);
		randomIdleMaxSeconds = Math.max(randomIdleMinSeconds, Number(backup.randomIdleMaxSeconds) || 20);
		motionTransitionInSeconds = sanitizeMotionTransition(backup.motionTransitionInSeconds);
		motionTransitionOutSeconds = sanitizeMotionTransition(backup.motionTransitionOutSeconds);
		noMotionAnimationId = validId(backup.noMotionAnimationId) ? backup.noMotionAnimationId : null;
		noMotionLockFacing = backup.noMotionLockFacing === undefined ? true : Boolean(backup.noMotionLockFacing);
		noMotionFacingStrength = sanitizeFacingStrength(backup.noMotionFacingStrength);
		motionAssignments = Object.fromEntries(
			Object.entries(backup.motionAssignments ?? {}).filter(
				([slot, animationId]) => (MOTION_SLOTS as readonly string[]).includes(slot) && (validId(animationId) || animationId === NO_MOTION_ASSIGNMENT)
			)
		);
		if (backup.presenceSettings) updatePresenceSettings({
			enterAnimationId: validId(backup.presenceSettings.enterAnimationId) ? backup.presenceSettings.enterAnimationId : null,
			exitAnimationId: validId(backup.presenceSettings.exitAnimationId) ? backup.presenceSettings.exitAnimationId : null,
			fadeSeconds: Number(backup.presenceSettings.fadeSeconds) || 0,
			autoExitEnabled: Boolean(backup.presenceSettings.autoExitEnabled),
			autoExitMinutes: Number(backup.presenceSettings.autoExitMinutes) || 30
		});
		await saveAnimationList();
		if (activeIdleAnimationId) await motionStorage?.setItem('active-idle-animation-id', activeIdleAnimationId);
		else await motionStorage?.removeItem('active-idle-animation-id');
		if (activeTalkingAnimationId) await motionStorage?.setItem('active-talking-animation-id', activeTalkingAnimationId);
		else await motionStorage?.removeItem('active-talking-animation-id');
		await motionStorage?.setItem('random-idle-animation-ids', randomIdleAnimationIds);
		await motionStorage?.setItem('random-idle-min-seconds', randomIdleMinSeconds);
		await motionStorage?.setItem('random-idle-max-seconds', randomIdleMaxSeconds);
		await motionStorage?.setItem('motion-transition-in-seconds', motionTransitionInSeconds);
		await motionStorage?.setItem('motion-transition-out-seconds', motionTransitionOutSeconds);
		if (noMotionAnimationId) await motionStorage?.setItem('no-motion-animation-id', noMotionAnimationId);
		else await motionStorage?.removeItem('no-motion-animation-id');
		await motionStorage?.setItem('no-motion-lock-facing', noMotionLockFacing);
		await motionStorage?.setItem('no-motion-facing-strength', noMotionFacingStrength);
		await motionStorage?.setItem('motion-assignments', motionAssignments);
		applyAnimationAssignments();
		return restored.length;
	}

	async function removeAnimation(id: string): Promise<void> {
		const animation = customAnimations.find((item) => item.id === id);
		if (!animation) return;
		if (animation.url.startsWith('blob:')) URL.revokeObjectURL(animation.url);
		await motionStorage?.removeItem(`animation-blob-${id}`);
		customAnimations = customAnimations.filter((item) => item.id !== id);
		availableAnimations = [...builtInAnimations, ...customAnimations];
		if (activeIdleAnimationId === id) activeIdleAnimationId = null;
		if (activeTalkingAnimationId === id) activeTalkingAnimationId = null;
		if (noMotionAnimationId === id) noMotionAnimationId = null;
		randomIdleAnimationIds = randomIdleAnimationIds.filter((animationId) => animationId !== id);
		motionAssignments = Object.fromEntries(
			Object.entries(motionAssignments).filter(([, animationId]) => animationId !== id)
		);
		if (presenceSettings.enterAnimationId === id || presenceSettings.exitAnimationId === id) {
			updatePresenceSettings({
				...presenceSettings,
				enterAnimationId: presenceSettings.enterAnimationId === id ? null : presenceSettings.enterAnimationId,
				exitAnimationId: presenceSettings.exitAnimationId === id ? null : presenceSettings.exitAnimationId
			});
		}
		await saveAnimationList();
		await motionStorage?.setItem('active-idle-animation-id', activeIdleAnimationId);
		await motionStorage?.setItem('active-talking-animation-id', activeTalkingAnimationId);
		await motionStorage?.setItem('random-idle-animation-ids', randomIdleAnimationIds);
		await motionStorage?.setItem('motion-assignments', motionAssignments);
		if (!noMotionAnimationId) await motionStorage?.removeItem('no-motion-animation-id');
		applyAnimationAssignments();
	}

	async function setIdleAnimation(id: string | null): Promise<void> {
		activeIdleAnimationId = id;
		if (id) await motionStorage?.setItem('active-idle-animation-id', id);
		else await motionStorage?.removeItem('active-idle-animation-id');
		applyAnimationAssignments();
	}

	async function setTalkingAnimation(id: string | null): Promise<void> {
		activeTalkingAnimationId = id;
		if (id) await motionStorage?.setItem('active-talking-animation-id', id);
		else await motionStorage?.removeItem('active-talking-animation-id');
		applyAnimationAssignments();
	}

	async function setRandomIdleAnimation(id: string, enabled: boolean): Promise<void> {
		randomIdleAnimationIds = enabled
			? [...new Set([...randomIdleAnimationIds, id])]
			: randomIdleAnimationIds.filter((animationId) => animationId !== id);
		await motionStorage?.setItem('random-idle-animation-ids', randomIdleAnimationIds);
		applyAnimationAssignments();
	}

	async function setAnimationLoop(id: string, loop: boolean): Promise<void> {
		customAnimations = customAnimations.map((animation) => animation.id === id ? { ...animation, loop } : animation);
		availableAnimations = [...builtInAnimations, ...customAnimations];
		await saveAnimationList();
	}

	async function setAnimationFacing(id: string, lockFacing: boolean, facingStrength: number): Promise<void> {
		customAnimations = customAnimations.map((animation) => animation.id === id ? { ...animation, lockFacing: Boolean(lockFacing), facingStrength: sanitizeFacingStrength(facingStrength) } : animation);
		availableAnimations = [...builtInAnimations, ...customAnimations];
		await saveAnimationList();
	}

	async function setRandomIdleInterval(minSeconds: number, maxSeconds: number): Promise<void> {
		randomIdleMinSeconds = Math.max(1, Number(minSeconds) || 10);
		randomIdleMaxSeconds = Math.max(randomIdleMinSeconds, Number(maxSeconds) || randomIdleMinSeconds);
		await motionStorage?.setItem('random-idle-min-seconds', randomIdleMinSeconds);
		await motionStorage?.setItem('random-idle-max-seconds', randomIdleMaxSeconds);
		randomIdleAnimationRevision += 1;
	}

	async function setMotionTransition(inSeconds: number, outSeconds: number): Promise<void> {
		motionTransitionInSeconds = sanitizeMotionTransition(inSeconds);
		motionTransitionOutSeconds = sanitizeMotionTransition(outSeconds);
		await motionStorage?.setItem('motion-transition-in-seconds', motionTransitionInSeconds);
		await motionStorage?.setItem('motion-transition-out-seconds', motionTransitionOutSeconds);
	}

	async function setNoMotionSettings(animationId: string | null, lockFacing: boolean, facingStrength: number): Promise<void> {
		noMotionAnimationId = animationId && availableAnimations.some((animation) => animation.id === animationId) ? animationId : null;
		noMotionLockFacing = Boolean(lockFacing);
		noMotionFacingStrength = sanitizeFacingStrength(facingStrength);
		if (noMotionAnimationId) await motionStorage?.setItem('no-motion-animation-id', noMotionAnimationId);
		else await motionStorage?.removeItem('no-motion-animation-id');
		await motionStorage?.setItem('no-motion-lock-facing', noMotionLockFacing);
		await motionStorage?.setItem('no-motion-facing-strength', noMotionFacingStrength);
	}

	async function setMotionAssignment(slot: string, animationId: string | null): Promise<void> {
		if (animationId) motionAssignments = { ...motionAssignments, [slot]: animationId };
		else {
			const next = { ...motionAssignments };
			delete next[slot];
			motionAssignments = next;
		}
		await motionStorage?.setItem('motion-assignments', motionAssignments);
	}

	function playMappedMotion(slot: string): boolean {
		const animationId = motionAssignments[String(slot).trim().toLowerCase()];
		if (animationId === NO_MOTION_ASSIGNMENT) return playNoMotion();
		if (!animationId || !availableAnimations.some((animation) => animation.id === animationId)) return false;
		setCurrentAnimation(animationId);
		return true;
	}

	function playNoMotion(): boolean {
		if (!noMotionAnimationId || !availableAnimations.some((animation) => animation.id === noMotionAnimationId)) {
			setCurrentAnimation(null);
			noMotionPlaying = true;
			return false;
		}
		setCurrentAnimation(noMotionAnimationId);
		noMotionPlaying = true;
		return true;
	}

	function startThinkingMotion(): boolean {
		if (presenceState !== 'present' || thinkingMotionActive) return false;
		const animationId = motionAssignments.thinking;
		if (animationId === NO_MOTION_ASSIGNMENT) {
			const played = playNoMotion();
			thinkingMotionActive = played;
			if (played) markPresenceActivity();
			return played;
		}
		if (!animationId || !availableAnimations.some((animation) => animation.id === animationId)) return false;
		thinkingMotionActive = true;
		markPresenceActivity();
		setCurrentAnimation(animationId, true);
		return true;
	}

	function stopThinkingMotion(holdForReply = false) {
		if (!thinkingMotionActive) return;
		thinkingMotionActive = false;
		if (holdForReply) {
			// AICommentViewer sends thinking_stop immediately before the chat reply.
			// Keep the current pose alive so the reply motion can crossfade directly
			// instead of briefly falling through idle/talking in between.
			if (thinkingHandoffTimer) clearTimeout(thinkingHandoffTimer);
			thinkingHandoffTimer = setTimeout(() => {
				thinkingHandoffTimer = null;
				setCurrentAnimation(null);
			}, 5000);
		} else setCurrentAnimation(null);
		markPresenceActivity();
	}

	// Guard against saveToStorage running before init completes
	let storageReady = false;
	// Lets consumers wait for init so they don't act on pre-restore state
	let readyResolve: (() => void) | null = null;
	const ready = new Promise<void>((resolve) => {
		readyResolve = resolve;
	});
	// Prevents re-emitting sync events when handling incoming ones
	let isSyncing = false;
	// Held so the handler can be released (HMR re-runs this module in dev;
	// without it each run would stack another duplicate listener)
	let modelChangedUnlisten: Promise<(() => void) | undefined> | null = null;

	// Initialize from storage (may override defaults with saved values)
	if (browser) {
		initFromStorage();

		// Sync model changes from other Tauri windows
		if (isTauri()) {
			modelChangedUnlisten = import('@tauri-apps/api/event').then(({ listen }) =>
				listen('vrm:model-changed', async () => {
					// Drop events that arrive while a sync is already running
					if (isSyncing) return;
					isSyncing = true;
					try {
						await syncActiveModel();
					} finally {
						isSyncing = false;
					}
				})
			);
		}

		if (import.meta.hot) {
			import.meta.hot.dispose(() => {
				modelChangedUnlisten?.then((unlisten) => unlisten?.());
				modelChangedUnlisten = null;
			});
		}
	}

	async function initFromStorage() {
		try {
			// Load saved models list
			const savedModels = await vrmStorage?.getItem<VrmModel[]>('model-list');
			if (savedModels && savedModels.length > 0) {
				const customModels = savedModels.filter((m) => !m.isDefault);

				// Load all blobs concurrently; users with several custom models were
				// paying one storage round-trip per model at boot
				const blobs = await Promise.all(
					customModels.map((model) => vrmStorage?.getItem<Blob>(`model-blob-${model.id}`))
				);
				const restored: VrmModel[] = [];
				customModels.forEach((model, i) => {
					const blob = blobs[i];
					// Regenerate blob URL from stored blob data
					if (blob) {
						restored.push({
							...model,
							url: URL.createObjectURL(blob)
						});
					}
					// If blob is missing, skip this model (unrecoverable)
				});

				models = [...DEFAULT_MODELS, ...restored];
			}

			// Restore preview thumbnails for all models (also concurrent)
			const previews = await Promise.all(
				models.map((model) => vrmStorage?.getItem<string>(`${PREVIEW_KEY_PREFIX}${model.id}`))
			);
			models = models.map((model, i) =>
				previews[i] ? { ...model, previewUrl: previews[i] } : model
			);

			// Load active model ID
			const savedActiveId = await vrmStorage?.getItem<string>('active-model-id');
			if (savedActiveId) {
				const activeModel = models.find((m) => m.id === savedActiveId);
				if (activeModel) {
					activeModelId = savedActiveId;
					modelUrl = activeModel.url;
				} else {
					activeModelId = DEFAULT_MODELS[0].id;
					modelUrl = DEFAULT_MODELS[0].url;
					await vrmStorage?.removeItem('active-model-id');
				}
			} else {
				activeModelId = DEFAULT_MODELS[0].id;
				modelUrl = DEFAULT_MODELS[0].url;
			}
		} catch (e) {
			console.error('Failed to load VRM storage:', e);
			activeModelId = DEFAULT_MODELS[0].id;
			modelUrl = DEFAULT_MODELS[0].url;
		}
		loadExpressionSettings(activeModelId);
		storageReady = true;
		readyResolve?.();
		// Flush any saves that were blocked during init
		await saveToStorage();
	}

	async function saveToStorage() {
		if (!vrmStorage || !storageReady || !tempVrm.canSave(tempState)) return;
		try {
			// Save custom models (not defaults) — strip blob URLs since they're ephemeral
			const customModels = models
				.filter((m) => !m.isDefault)
				.map(({ url, previewUrl, ...rest }) => rest);
			await vrmStorage.setItem('model-list', customModels);
			await vrmStorage.setItem('active-model-id', activeModelId);
		} catch (e) {
			console.error('Failed to save VRM storage:', e);
		}
	}

	function setModelUrl(url: string | null) {
		modelUrl = url;
		error = null;
	}

	function setVrm(instance: VRM | null) {
		vrm = instance;
		// Store available expressions when VRM is set
		if (instance?.expressionManager) {
			availableExpressions = instance.expressionManager.expressions.map((e) => e.expressionName);
		}
	}

	function setLoading(loading: boolean) {
		isLoading = loading;
		if (!loading) {
			// The temporary model has finished parsing (or gave up).
			tempVrm.onLoadingFinished(tempState);
		}
	}

	function clearError() {
		if (errorTimeout) {
			clearTimeout(errorTimeout);
			errorTimeout = null;
		}
		error = null;
	}

	function setError(err: string | null) {
		clearError();
		// Track temp-load failures separately from other errors so the Developer
		// page can restore the original avatar without catching unrelated errors.
		if (err) {
			tempVrm.onError(tempState);
		}
		error = err;
		isLoading = false;
		// Auto-dismiss after 5 seconds if error is set
		if (err) {
			errorTimeout = setTimeout(() => {
				error = null;
				errorTimeout = null;
			}, 5000);
		}
	}

	async function setActiveModel(id: string) {
		const model = models.find((m) => m.id === id);
		if (model) {
		activeModelId = id;
		loadExpressionSettings(id);
			modelUrl = model.url;
			await saveToStorage();
			broadcastModelChange();
		}
	}

	async function broadcastModelChange() {
		if (!isTauri() || isSyncing) return;
		const { emit } = await import('@tauri-apps/api/event');
		emit('vrm:model-changed');
	}

	async function syncActiveModel() {
		if (!storageReady || tempModelActive) return;
		const savedActiveId = await vrmStorage?.getItem<string>('active-model-id');
		if (!savedActiveId || savedActiveId === activeModelId) return;

		// Check if model exists in our list already
		const model = models.find((m) => m.id === savedActiveId);
		if (model) {
			activeModelId = savedActiveId;
			loadExpressionSettings(savedActiveId);
			modelUrl = model.url;
		} else {
			// New custom model added in another window — full re-init
			await initFromStorage();
		}
	}

	// These run every frame from the render loop. Skip the reactive write when the
	// value hasn't meaningfully moved, so a near-still model doesn't churn every
	// $derived bound to head position 60×/sec.
	function setHeadPosition(pos: [number, number, number]) {
		const p = headPosition;
		if (Math.abs(p[0] - pos[0]) < 0.001 && Math.abs(p[1] - pos[1]) < 0.001 && Math.abs(p[2] - pos[2]) < 0.001) {
			return;
		}
		headPosition = pos;
	}

	function setHeadScreenPosition(pos: { x: number; y: number } | null) {
		const p = headScreenPosition;
		if (pos && p && Math.abs(p.x - pos.x) < 0.05 && Math.abs(p.y - pos.y) < 0.05) {
			return;
		}
		headScreenPosition = pos;
	}

	function setCurrentAnimation(animationIdOrPath: string | null, loopOverride?: boolean) {
		if (thinkingHandoffTimer) {
			clearTimeout(thinkingHandoffTimer);
			thinkingHandoffTimer = null;
		}
		noMotionPlaying = false;
		// Accept either an animation ID or a direct path
		// If it's a path (starts with /), use it directly
		// Otherwise, look up the animation by ID
		if (animationIdOrPath === null || animationIdOrPath === 'none') {
			currentAnimation = null;
		} else if (animationIdOrPath.startsWith('/')) {
			// Direct path - use as-is
			currentAnimation = animationIdOrPath;
			currentAnimationLoop = loopOverride ?? false;
		} else {
			// Look up by ID in availableAnimations
			const anim = availableAnimations.find((a) => a.id === animationIdOrPath);
			currentAnimation = anim?.url || null;
			currentAnimationLoop = loopOverride ?? Boolean((anim as CustomAnimation | undefined)?.loop);
		}
		if (!currentAnimation) currentAnimationLoop = false;
		currentAnimationRevision += 1;
	}

	// Start talking animation based on text length
	// Estimates ~15 characters per second of speaking
	function startTalking(text: string) {
		markPresenceActivity();
		// Clear any existing timeout
		if (talkingTimeout) {
			clearTimeout(talkingTimeout);
		}

		// Calculate duration: ~15 chars/sec, minimum 1 second
		const charsPerSecond = 15;
		const duration = Math.max(1, text.length / charsPerSecond) * 1000;

		isTalking = true;

		// Auto-stop after estimated duration
		talkingTimeout = setTimeout(() => {
			isTalking = false;
			talkingTimeout = null;
		}, duration);
	}

	// Stop talking animation immediately
	function stopTalking() {
		if (talkingTimeout) {
			clearTimeout(talkingTimeout);
			talkingTimeout = null;
		}
		isTalking = false;
	}

	function flashExpression(name: string, value = 0.75, durationMs = 3000) {
		if (!vrm?.expressionManager || !availableExpressions.includes(name)) return false;
		activeExpression = { name, value, startedAt: performance.now(), durationMs, seq: ++expressionSeq };
		return true;
	}

	function loadTempModel(file: File): void {
		tempVrm.load(tempState, file);
	}

	function restoreOriginalModel(): void {
		// Clear any earlier temp-load error so a successful restore does not
		// keep a stale "Failed to parse VRM" message on screen.
		clearError();
		tempVrm.restore(tempState, models, DEFAULT_MODELS);
		// Defensive: if neither the original nor any default could be restored,
		// surface an error instead of leaving the viewport blank silently.
		if (!tempModelActive && activeModelId === null && modelUrl === null) {
			setError('No VRM model available to restore.');
		}
	}

	async function addModel(file: File, previewDataUrl?: string): Promise<void> {
		const id = `custom-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
		const name = file.name.replace(/\.vrm$/i, '');

		// Store the file blob
		const blob = new Blob([await file.arrayBuffer()], { type: 'model/vrm' });
		await vrmStorage?.setItem(`model-blob-${id}`, blob);

		// Create blob URL for immediate use
		const url = URL.createObjectURL(blob);

		const newModel: VrmModel = {
			id,
			name,
			url,
			previewUrl: previewDataUrl,
			isDefault: false,
			createdAt: Date.now()
		};

		models = [...models, newModel];
		await saveToStorage();

		// Store preview if provided
		if (previewDataUrl) {
			await vrmStorage?.setItem(`${PREVIEW_KEY_PREFIX}${id}`, previewDataUrl);
		}
	}

	async function removeModel(id: string): Promise<void> {
		const model = models.find((m) => m.id === id);
		if (!model || model.isDefault) return;

		// Revoke blob URL to free memory
		if (model.url.startsWith('blob:')) {
			URL.revokeObjectURL(model.url);
		}

		// Remove from storage
		await vrmStorage?.removeItem(`model-blob-${id}`);
		await vrmStorage?.removeItem(`${PREVIEW_KEY_PREFIX}${id}`);

		// Remove from list
		models = models.filter((m) => m.id !== id);

		// If this was the active model, switch to default
		if (activeModelId === id) {
			setActiveModel(DEFAULT_MODELS[0].id);
		}

		await saveToStorage();
	}

	function getActiveModel(): VrmModel | null {
		return models.find((m) => m.id === activeModelId) || null;
	}

	async function setModelPreview(modelId: string | null, previewDataUrl: string): Promise<void> {
		if (!modelId) return;

		// Update in models array
		const modelIndex = models.findIndex((m) => m.id === modelId);
		if (modelIndex !== -1) {
			models[modelIndex] = { ...models[modelIndex], previewUrl: previewDataUrl };
			// Trigger reactivity
			models = [...models];
		}

		// Save to storage for all models (including defaults) so thumbnails persist
		await vrmStorage?.setItem(`${PREVIEW_KEY_PREFIX}${modelId}`, previewDataUrl);
	}

	return {
		get modelUrl() {
			return modelUrl;
		},
		get vrm() {
			return vrm;
		},
		get isLoading() {
			return isLoading;
		},
		get error() {
			return error;
		},
		get models() {
			return models;
		},
		get activeModelId() {
			return activeModelId;
		},
		get availableExpressions() {
			return availableExpressions;
		},
		get currentAnimation() {
			return currentAnimation;
		},
		get availableAnimations() {
			return availableAnimations;
		},
		get expressionSettings() { return expressionSettings; },
		get activeExpression() { return activeExpression; },
		updateExpressionSettings,
		clearActiveExpression,
		get currentAnimationRevision() { return currentAnimationRevision; },
		get currentAnimationLoop() { return currentAnimationLoop; },
		get currentAnimationLocksFacing() { return Boolean(customAnimations.find((animation) => animation.url === currentAnimation)?.lockFacing); },
		get currentAnimationFacingStrength() { return sanitizeFacingStrength(customAnimations.find((animation) => animation.url === currentAnimation)?.facingStrength); },
		get noMotionPlaying() { return noMotionPlaying; },
		get noMotionAnimationId() { return noMotionAnimationId; },
		get noMotionLockFacing() { return noMotionLockFacing; },
		get noMotionFacingStrength() { return noMotionFacingStrength; },
		get thinkingMotionActive() { return thinkingMotionActive; },
		startThinkingMotion,
		stopThinkingMotion,
		get presenceSettings() { return presenceSettings; },
		get presenceState() { return presenceState; },
		get pendingPresenceAction() { return pendingPresenceAction; },
		get autoExitSecondsRemaining() { return autoExitSecondsRemaining; },
		updatePresenceSettings,
		requestPresence,
		markPresenceActivity,
		notifyAnimationCompleted,
		get customAnimations() {
			return customAnimations;
		},
		get activeIdleAnimationId() {
			return activeIdleAnimationId;
		},
		get activeTalkingAnimationId() {
			return activeTalkingAnimationId;
		},
		get randomIdleAnimationIds() {
			return randomIdleAnimationIds;
		},
		get randomIdleAnimationRevision() { return randomIdleAnimationRevision; },
		get randomIdleMinSeconds() { return randomIdleMinSeconds; },
		get randomIdleMaxSeconds() { return randomIdleMaxSeconds; },
		get motionTransitionInSeconds() { return motionTransitionInSeconds; },
		get motionTransitionOutSeconds() { return motionTransitionOutSeconds; },
		setMotionTransition,
		setNoMotionSettings,
		get motionAssignments() {
			return motionAssignments;
		},
		get idleAnimationRevision() {
			return idleAnimationRevision;
		},
		get talkingAnimationRevision() {
			return talkingAnimationRevision;
		},
		get idleAnimationUrl() {
			return idleAnimationUrl;
		},
		get idleAnimationUrls() {
			return idleAnimationUrls;
		},
		get talkingAnimationUrl() {
			return talkingAnimationUrl;
		},
		get isTalking() {
			return isTalking;
		},
		get reactionRequest() {
			return reactionRequest;
		},
		requestReaction,
		get headPosition() {
			return headPosition;
		},
		get headScreenPosition() {
			return headScreenPosition;
		},
		get tempModelActive() {
			return tempModelActive;
		},
		get tempModelLoading() {
			return tempModelLoading;
		},
		get tempModelLoadError() {
			return tempModelLoadError;
		},
		setModelUrl,
		setHeadPosition,
		setHeadScreenPosition,
		setVrm,
		setLoading,
		setError,
		setActiveModel,
		setCurrentAnimation,
		startTalking,
		stopTalking,
		flashExpression,
		addAnimation,
		exportMotionBackup,
		importMotionBackup,
		removeAnimation,
		setIdleAnimation,
		setTalkingAnimation,
		setRandomIdleAnimation,
		setAnimationLoop,
		setAnimationFacing,
		setRandomIdleInterval,
		setMotionAssignment,
		playMappedMotion,
		playNoMotion,
		addModel,
		removeModel,
		getActiveModel,
		setModelPreview,
		loadTempModel,
		restoreOriginalModel,
		whenReady: () => ready
	};
}

export const vrmStore = createVrmStore();
