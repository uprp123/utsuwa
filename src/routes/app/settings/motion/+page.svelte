<script lang="ts">
	import { MOTION_SLOTS, NO_MOTION_ASSIGNMENT, vrmStore } from '$lib/stores/vrm.svelte';
	import { goto } from '$app/navigation';
	import { localPath } from '$lib/config/links';
	let error = $state<string | null>(null);
	let notice = $state<string | null>(null);
	let importing = $state(false);
	const motionSlotLabels: Record<string, string> = {
		happy:'喜び', wave:'手を振る', clap:'拍手', cheer:'応援', surprised:'驚き', thinking:'考える',
		sad:'悲しい', angry:'怒り', bow:'お辞儀', dance:'ダンス', showcase:'全身を見せる',
		greeting:'挨拶', peace:'Vサイン', shoot:'撃つ', spin:'回る', model_pose:'モデルポーズ', squat:'屈伸運動'
	};

	async function importFiles(event: Event) {
		const input = event.currentTarget as HTMLInputElement;
		const files = Array.from(input.files ?? []);
		if (!files.length) return;
		importing = true;
		error = null;
		notice = null;
		try {
			for (const file of files) await vrmStore.addAnimation(file);
		} catch (e) {
			error = e instanceof Error ? e.message : 'Failed to import motion';
		} finally {
			importing = false;
			input.value = '';
		}
	}

	async function exportBackup() {
		importing = true;
		error = null;
		notice = null;
		try {
			const blob = await vrmStore.exportMotionBackup();
			const url = URL.createObjectURL(blob);
			const link = document.createElement('a');
			link.href = url;
			link.download = `utsuwa-motion-backup-${new Date().toISOString().slice(0, 10)}.json`;
			link.click();
			URL.revokeObjectURL(url);
			notice = `Exported ${vrmStore.customAnimations.length} motion file(s).`;
		} catch (e) {
			error = e instanceof Error ? e.message : 'Failed to export motion backup';
		} finally {
			importing = false;
		}
	}

	async function importBackup(event: Event) {
		const input = event.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		if (!file) return;
		if (!confirm('Replace all current motion files and assignments with this backup?')) {
			input.value = '';
			return;
		}
		importing = true;
		error = null;
		notice = null;
		try {
			const count = await vrmStore.importMotionBackup(file);
			notice = `Restored ${count} motion file(s) and all assignments.`;
		} catch (e) {
			error = e instanceof Error ? e.message : 'Failed to import motion backup';
		} finally {
			importing = false;
			input.value = '';
		}
	}

	async function previewMotion(id: string) {
		vrmStore.setCurrentAnimation(id);
		await goto(localPath('app'));
	}
</script>

<div class="page">
	<header class="page-header">
		<h2>モーション設定</h2><p>VRMAの登録と、待機・会話・AIモーションの割り当てを行います。</p>
	</header>

	<section class="section import-section">
		<div>
			<h3>VRMAの追加</h3><p>ファイルはUtsuwa内に保存され、再起動後も使用できます。</p>
		</div>
		<label class="import-button" class:disabled={importing}>
			{importing ? '読み込み中…' : 'VRMAを追加'}
			<input type="file" accept=".vrma,.VRMA" multiple onchange={importFiles} disabled={importing} />
		</label>
	</section>

	<section class="section backup-section">
		<div>
			<h3>モーションのバックアップ</h3><p>VRMA本体とすべての割り当てを1ファイルに保存します。</p>
		</div>
		<div class="backup-actions">
			<button type="button" onclick={exportBackup} disabled={importing}>エクスポート</button>
			<label class="import-button" class:disabled={importing}>
				インポート
				<input type="file" accept=".json,application/json" onchange={importBackup} disabled={importing} />
			</label>
		</div>
	</section>

	{#if error}<p class="error">{error}</p>{/if}
	{#if notice}<p class="notice">{notice}</p>{/if}

	<section class="section assignments">
		<h3>基本モーション</h3>
		<label>
			<span>待機モーション</span>
			<select value={vrmStore.activeIdleAnimationId ?? ''} onchange={(e) => vrmStore.setIdleAnimation(e.currentTarget.value || null)}>
				<option value="">標準ランダム待機</option>
				{#each vrmStore.customAnimations as motion}<option value={motion.id}>{motion.name}</option>{/each}
			</select>
		</label>
		<label>
			<span>会話モーション</span>
			<select value={vrmStore.activeTalkingAnimationId ?? ''} onchange={(e) => vrmStore.setTalkingAnimation(e.currentTarget.value || null)}>
				<option value="">標準会話モーション</option>
				{#each vrmStore.customAnimations as motion}<option value={motion.id}>{motion.name}</option>{/each}
			</select>
		</label>
	</section>

	<section class="section no-motion-settings">
		<h3>モーション指定なしの動作</h3>
		<p>AI回答にモーション指定がない場合と、割り当てで「モーション指定なしの動作」を選んだ場合に使用します。</p>
		<label class="no-motion-select">
			<span>使用するモーション</span>
			<select value={vrmStore.noMotionAnimationId ?? ''} onchange={(e) => vrmStore.setNoMotionSettings(e.currentTarget.value || null, vrmStore.noMotionLockFacing, vrmStore.noMotionFacingStrength)}>
				<option value="">待機／会話モーションのまま</option>
				{#each vrmStore.availableAnimations as motion}<option value={motion.id}>{motion.name}</option>{/each}
			</select>
		</label>
		<div class="no-motion-facing">
			<label class="facing-check"><input type="checkbox" checked={vrmStore.noMotionLockFacing} onchange={(e) => vrmStore.setNoMotionSettings(vrmStore.noMotionAnimationId, e.currentTarget.checked, vrmStore.noMotionFacingStrength)} />正面向きを維持</label>
			<label class="facing-strength" class:disabled={!vrmStore.noMotionLockFacing}>
				<span>補正の強さ {Math.round(vrmStore.noMotionFacingStrength * 100)}%</span>
				<input type="range" min="0" max="100" step="5" value={vrmStore.noMotionFacingStrength * 100} disabled={!vrmStore.noMotionLockFacing} oninput={(e) => vrmStore.setNoMotionSettings(vrmStore.noMotionAnimationId, vrmStore.noMotionLockFacing, Number(e.currentTarget.value) / 100)} />
			</label>
		</div>
	</section>

	<section class="section transition-settings">
		<h3>モーション切り替え時間</h3>
		<p>待機姿勢と指定モーションの間を、何秒かけて滑らかに切り替えるかを設定します。</p>
		<div class="interval-settings">
			<label>待機 → モーション（秒）<input type="number" min="0.05" max="10" step="0.05" value={vrmStore.motionTransitionInSeconds} onchange={(e) => vrmStore.setMotionTransition(Number(e.currentTarget.value), vrmStore.motionTransitionOutSeconds)} /></label>
			<label>モーション → 待機（秒）<input type="number" min="0.05" max="10" step="0.05" value={vrmStore.motionTransitionOutSeconds} onchange={(e) => vrmStore.setMotionTransition(vrmStore.motionTransitionInSeconds, Number(e.currentTarget.value))} /></label>
		</div>
	</section>

	<section class="section random-idles">
		<h3>ランダム待機モーション</h3><p>選択したモーションを待機中のローテーションへ追加します。</p>
		<div class="interval-settings">
			<label>最短（秒）<input type="number" min="1" value={vrmStore.randomIdleMinSeconds} onchange={(e) => vrmStore.setRandomIdleInterval(Number(e.currentTarget.value), vrmStore.randomIdleMaxSeconds)} /></label>
			<label>最長（秒）<input type="number" min="1" value={vrmStore.randomIdleMaxSeconds} onchange={(e) => vrmStore.setRandomIdleInterval(vrmStore.randomIdleMinSeconds, Number(e.currentTarget.value))} /></label>
		</div>
		{#if vrmStore.customAnimations.length === 0}
			<p class="empty">Import VRMA files to add random idle motions.</p>
		{:else}
			<div class="check-list">
				{#each vrmStore.customAnimations as motion}
					<label>
						<input
							type="checkbox"
							checked={vrmStore.randomIdleAnimationIds.includes(motion.id)}
							onchange={(e) => vrmStore.setRandomIdleAnimation(motion.id, e.currentTarget.checked)}
						/>
						<span>{motion.name}</span>
					</label>
				{/each}
			</div>
		{/if}
	</section>

	<section class="section assignments">
		<h3>AIモーション割り当て</h3><p>AICommentViewerから送られるモーション名に動きを割り当てます。</p>
		{#each MOTION_SLOTS as slot}
			<label>
				<span>{motionSlotLabels[slot] ?? slot}</span>
				<select value={vrmStore.motionAssignments[slot] ?? ''} onchange={(e) => vrmStore.setMotionAssignment(slot, e.currentTarget.value || null)}>
					<option value="">割り当てなし</option>
					<option value={NO_MOTION_ASSIGNMENT}>モーション指定なしの動作</option>
					{#each vrmStore.availableAnimations as motion}<option value={motion.id}>{motion.name}</option>{/each}
				</select>
			</label>
		{/each}
	</section>

	<section class="section library">
		<h3>追加済みモーション</h3>
		{#if vrmStore.customAnimations.length === 0}
			<p class="empty">No custom motion imported yet.</p>
		{:else}
			{#each vrmStore.customAnimations as motion}
				<div class="motion-row">
					<div><strong>{motion.name}</strong><small>VRMA</small></div>
					<div class="motion-options">
						<label class="facing-check"><input type="checkbox" checked={Boolean(motion.lockFacing)} onchange={(e) => vrmStore.setAnimationFacing(motion.id, e.currentTarget.checked, motion.facingStrength ?? 1)} />正面向きを維持</label>
						<label class="facing-strength" class:disabled={!motion.lockFacing}>
							<span>補正の強さ {Math.round((motion.facingStrength ?? 1) * 100)}%</span>
							<input type="range" min="0" max="100" step="5" value={(motion.facingStrength ?? 1) * 100} disabled={!motion.lockFacing} oninput={(e) => vrmStore.setAnimationFacing(motion.id, Boolean(motion.lockFacing), Number(e.currentTarget.value) / 100)} />
						</label>
					</div>
					<div class="actions">
						<label class="loop-check"><input type="checkbox" checked={Boolean(motion.loop)} onchange={(e) => vrmStore.setAnimationLoop(motion.id, e.currentTarget.checked)} />会話中ループ</label>
						<button type="button" onclick={() => previewMotion(motion.id)}>1回プレビュー</button>
						<button class="danger" type="button" onclick={() => vrmStore.removeAnimation(motion.id)}>削除</button>
					</div>
				</div>
			{/each}
		{/if}
		<p class="hint">手振り・拍手などで体が横を向く場合は「正面向きを維持」をONにします。回転や振り返りを含むモーションではOFFにしてください。</p>
	</section>
</div>

<style>
	@import '../settings-page.css';
	.page{z-index:1}.section{margin-bottom:1rem}.section h3{margin:0 0 .35rem}.section p{margin:.2rem 0;color:var(--text-secondary);font-size:.875rem}.import-section,.backup-section{display:flex;align-items:center;justify-content:space-between;gap:1rem}.backup-actions{display:flex;gap:.5rem;flex-shrink:0}.import-button,button{border:0;border-radius:var(--radius-md);padding:.65rem .9rem;background:var(--accent);color:white;font-weight:600;cursor:pointer}.import-button input{display:none}.import-button.disabled,button:disabled{opacity:.6;pointer-events:none}.assignments{display:grid;gap:1rem}.assignments label{display:grid;grid-template-columns:150px 1fr;align-items:center;gap:1rem}.assignments span{font-weight:600}.assignments select,.transition-settings input{padding:.7rem;border:1px solid var(--border-light);border-radius:var(--radius-md);background:var(--bg-secondary);color:var(--text-primary)}.transition-settings .interval-settings{display:grid;grid-template-columns:repeat(2,minmax(220px,1fr));gap:1rem;margin-top:.8rem}.transition-settings label{display:grid;gap:.45rem;font-weight:600}.check-list{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:.55rem;margin-top:1rem}.check-list label{display:flex;align-items:center;gap:.55rem;padding:.65rem;background:var(--bg-secondary);border-radius:var(--radius-md)}.check-list input{width:1.1rem;height:1.1rem}.motion-row{gap:1rem;padding:.85rem 0;border-bottom:1px solid var(--border-light)}.motion-row:last-child{border-bottom:0}.motion-row div:first-child{display:flex;flex-direction:column;gap:.2rem}.motion-row small{color:var(--text-tertiary)}.actions{display:flex;gap:.5rem}.actions .danger{background:var(--color-error)}.empty{padding:1rem 0}.error{color:var(--color-error);font-weight:600}.notice{color:var(--color-success);font-weight:600}@media(max-width:640px){.import-section,.backup-section{align-items:stretch;flex-direction:column}.backup-actions{flex-wrap:wrap}.assignments label,.transition-settings .interval-settings{grid-template-columns:1fr}.actions button{flex:1}}
	.motion-row {
		display: grid;
		grid-template-columns: minmax(140px, 1fr) minmax(250px, 1.5fr) auto;
		align-items: center;
	}
	.motion-options { display: grid; gap: .45rem; }
	.no-motion-settings { display: grid; gap: .75rem; }
	.no-motion-select { display: grid; grid-template-columns: 180px minmax(220px, 1fr); align-items: center; gap: 1rem; font-weight: 600; }
	.no-motion-select select { padding: .7rem; border: 1px solid var(--border-light); border-radius: var(--radius-md); background: var(--bg-secondary); color: var(--text-primary); }
	.no-motion-facing { display: grid; grid-template-columns: 180px minmax(250px, 1fr); align-items: center; gap: 1rem; padding: .7rem; background: var(--bg-secondary); border-radius: var(--radius-md); }
	.facing-check { display: flex; align-items: center; gap: .5rem; font-weight: 600; }
	.facing-strength { display: grid; grid-template-columns: 115px minmax(110px, 1fr); align-items: center; gap: .65rem; font-size: .82rem; }
	.facing-strength.disabled { opacity: .45; }
	.facing-strength input { width: 100%; }
	.hint { margin-top: .85rem !important; }
	@media (max-width: 760px) {
		.motion-row { grid-template-columns: 1fr; align-items: stretch; }
		.no-motion-select, .no-motion-facing { grid-template-columns: 1fr; }
	}
</style>
