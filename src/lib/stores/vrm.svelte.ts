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
}

interface MotionBackupAnimation {
	id: string;
	name: string;
	createdAt: number;
	data: string;
}

interface MotionBackup {
	format: 'utsuwa-motion-backup';
	version: 1;
	exportedAt: string;
	animations: MotionBackupAnimation[];
	activeIdleAnimationId: string | null;
	activeTalkingAnimationId: string | null;
	randomIdleAnimationIds: string[];
	motionAssignments: Record<string, string>;
}

export const MOTION_SLOTS = [
	'happy', 'wave', 'clap', 'cheer', 'surprised', 'thinking', 'sad', 'angry', 'bow', 'dance',
	'showcase', 'greeting', 'peace', 'shoot', 'spin', 'model_pose', 'squat'
] as const;

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

	// Talking animation state (triggered by text output)
	let isTalking = $state(false);
	let talkingTimeout: ReturnType<typeof setTimeout> | null = null;

	// Tap reactions: the scene raycasts a tap into a touch zone and the model
	// component applies the staged reaction. Universal, not photo-mode-only.
	let reactionRequest = $state<{ zone: TouchZone; seq: number } | null>(null);
	let reactionSeq = 0;
	function requestReaction(zone: TouchZone) {
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
	let motionAssignments = $state<Record<string, string>>({});

	// Selectable one-shot emotes (played via the developer tools). These are the
	// VRMA files shipped in static/animations/ that aren't part of the idle cycle
	// or the talking loop.
	const builtInAnimations: { id: string; name: string; url: string }[] = [
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
	let availableAnimations = $state<{ id: string; name: string; url: string }[]>([
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
				if (blob) restored.push({ ...animation, url: URL.createObjectURL(blob) });
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
			applyAnimationAssignments();
		} catch (e) {
			console.error('Failed to restore custom animations:', e);
		}
	}

	function applyAnimationAssignments() {
		const idle = customAnimations.find((animation) => animation.id === activeIdleAnimationId);
		const randomIdles = randomIdleAnimationIds
			.map((id) => customAnimations.find((animation) => animation.id === id)?.url)
			.filter((url): url is string => Boolean(url));
		idleAnimationUrls = idle
			? [...new Set([idle.url, ...randomIdles])]
			: [...new Set([...builtInIdleAnimationUrls, ...randomIdles])];
		const talking = customAnimations.find((animation) => animation.id === activeTalkingAnimationId);
		talkingAnimationUrl = talking?.url ?? '/animations/talking.vrma';
		idleAnimationRevision += 1;
		talkingAnimationRevision += 1;
	}

	async function saveAnimationList() {
		await motionStorage?.setItem(
			'animation-list',
			customAnimations.map(({ id, name, createdAt }) => ({ id, name, createdAt }))
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
			motionAssignments: { ...motionAssignments }
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
				metadata: { id, name: item.name.trim() || 'Imported motion', createdAt: Number(item.createdAt) || Date.now() },
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
		motionAssignments = Object.fromEntries(
			Object.entries(backup.motionAssignments ?? {}).filter(
				([slot, animationId]) => (MOTION_SLOTS as readonly string[]).includes(slot) && validId(animationId)
			)
		);
		await saveAnimationList();
		if (activeIdleAnimationId) await motionStorage?.setItem('active-idle-animation-id', activeIdleAnimationId);
		else await motionStorage?.removeItem('active-idle-animation-id');
		if (activeTalkingAnimationId) await motionStorage?.setItem('active-talking-animation-id', activeTalkingAnimationId);
		else await motionStorage?.removeItem('active-talking-animation-id');
		await motionStorage?.setItem('random-idle-animation-ids', randomIdleAnimationIds);
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
		randomIdleAnimationIds = randomIdleAnimationIds.filter((animationId) => animationId !== id);
		motionAssignments = Object.fromEntries(
			Object.entries(motionAssignments).filter(([, animationId]) => animationId !== id)
		);
		await saveAnimationList();
		await motionStorage?.setItem('active-idle-animation-id', activeIdleAnimationId);
		await motionStorage?.setItem('active-talking-animation-id', activeTalkingAnimationId);
		await motionStorage?.setItem('random-idle-animation-ids', randomIdleAnimationIds);
		await motionStorage?.setItem('motion-assignments', motionAssignments);
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
		if (!animationId || !availableAnimations.some((animation) => animation.id === animationId)) return false;
		setCurrentAnimation(animationId);
		return true;
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

	function setCurrentAnimation(animationIdOrPath: string | null) {
		// Accept either an animation ID or a direct path
		// If it's a path (starts with /), use it directly
		// Otherwise, look up the animation by ID
		if (animationIdOrPath === null || animationIdOrPath === 'none') {
			currentAnimation = null;
		} else if (animationIdOrPath.startsWith('/')) {
			// Direct path - use as-is
			currentAnimation = animationIdOrPath;
		} else {
			// Look up by ID in availableAnimations
			const anim = availableAnimations.find((a) => a.id === animationIdOrPath);
			currentAnimation = anim?.url || null;
		}
		currentAnimationRevision += 1;
	}

	// Start talking animation based on text length
	// Estimates ~15 characters per second of speaking
	function startTalking(text: string) {
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
		const manager = vrm?.expressionManager;
		if (!manager || !availableExpressions.includes(name)) return false;
		manager.setValue(name, value);
		manager.update();
		setTimeout(() => {
			if (vrm?.expressionManager) {
				vrm.expressionManager.setValue(name, 0);
				vrm.expressionManager.update();
			}
		}, durationMs);
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
		get currentAnimationRevision() { return currentAnimationRevision; },
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
		setMotionAssignment,
		playMappedMotion,
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
