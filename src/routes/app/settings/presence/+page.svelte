<script lang="ts">
	import VrmScene from '$lib/components/vrm/VrmScene.svelte';
	import { vrmStore, type PresenceSettings, type PresenceState } from '$lib/stores/vrm.svelte';

	const stateLabels: Record<PresenceState, string> = {
		present: '在席', entering: '入場中', exiting: '退場中', hidden: '退場済み'
	};
	let draft = $state<PresenceSettings>({
		enterAnimationId: vrmStore.presenceSettings.enterAnimationId,
		exitAnimationId: vrmStore.presenceSettings.exitAnimationId,
		fadeSeconds: vrmStore.presenceSettings.fadeSeconds,
		autoExitEnabled: vrmStore.presenceSettings.autoExitEnabled,
		autoExitMinutes: vrmStore.presenceSettings.autoExitMinutes
	});
	let notice = $state('');

	function save() {
		vrmStore.updatePresenceSettings({ ...draft, fadeSeconds: Number(draft.fadeSeconds) });
		notice = '入退場設定を保存しました。';
	}
	function run(action: 'enter' | 'exit') {
		save();
		notice = action === 'enter' ? '入場動作を開始しました。' : '退場動作を開始しました。';
		vrmStore.requestPresence(action);
	}
</script>

<div class="page">
	<header class="page-header">
		<h2>入退場設定</h2>
		<p>Utsuwa単体で入場・退場モーションと表示状態を確認できます。</p>
	</header>
	<div class="presence-layout">
		<aside class="preview-panel">
			<div class="preview"><VrmScene centered locked /></div>
			<div class="status"><span class:away={vrmStore.presenceState === 'hidden'}></span>状態：<strong>{stateLabels[vrmStore.presenceState]}</strong></div>
			{#if vrmStore.autoExitSecondsRemaining !== null}
				<p class="countdown">自動退場まで：{Math.floor(vrmStore.autoExitSecondsRemaining / 60)}分{vrmStore.autoExitSecondsRemaining % 60}秒</p>
			{/if}
			<div class="manual-actions">
				<button type="button" onclick={() => run('enter')} disabled={vrmStore.presenceState === 'present' || vrmStore.presenceState === 'entering'}>入場</button>
				<button class="exit" type="button" onclick={() => run('exit')} disabled={vrmStore.presenceState === 'hidden' || vrmStore.presenceState === 'exiting'}>退場</button>
			</div>
		</aside>
		<div class="controls">
			<section class="section">
				<h3>モーション</h3>
				<p>未設定の場合はフェードだけで入退場します。どちらも1回だけ再生され、入場後は待機モーションへ戻ります。</p>
				<label><span>入場モーション</span><select bind:value={draft.enterAnimationId}><option value={null}>モーションなし</option>{#each vrmStore.availableAnimations as motion}<option value={motion.id}>{motion.name}</option>{/each}</select></label>
				<label><span>退場モーション</span><select bind:value={draft.exitAnimationId}><option value={null}>モーションなし</option>{#each vrmStore.availableAnimations as motion}<option value={motion.id}>{motion.name}</option>{/each}</select></label>
			</section>
			<section class="section">
				<h3>退場時の姿勢</h3>
				<p>退場モーションは1回だけ再生し、終了フレームの姿勢を保持します。待機モーションへは戻らず、次の入場モーションがその姿勢から始まります。</p>
			</section>
			<section class="section">
				<h3>自動退場</h3>
				<label class="toggle-row"><span>自動退場を有効にする</span><input type="checkbox" bind:checked={draft.autoExitEnabled} /></label>
				<label><span>無操作時間（分）</span><input type="number" min="0.1" max="1440" step="0.5" bind:value={draft.autoExitMinutes} disabled={!draft.autoExitEnabled} /></label>
				<p>発話、キャラクターのクリック、手動入場があると計測を最初からやり直します。OFFの場合は自動で退場しません。</p>
			</section>
			{#if notice}<p class="notice">{notice}</p>{/if}
			<button class="save" type="button" onclick={save}>設定を保存</button>
		</div>
	</div>
</div>

<style>
	@import '../settings-page.css';
	.page{z-index:1}.presence-layout{display:grid;grid-template-columns:minmax(300px,38%) 1fr;gap:1rem;align-items:start}.preview-panel{position:sticky;top:0}.preview{height:520px;background:var(--bg-secondary);border-radius:var(--radius-lg);overflow:hidden;box-shadow:var(--shadow-sm)}.status{display:flex;align-items:center;justify-content:center;gap:.4rem;padding:.75rem .75rem .25rem}.status span{width:.65rem;height:.65rem;border-radius:50%;background:var(--color-success)}.status span.away{background:var(--text-tertiary)}.countdown{text-align:center;margin:.35rem 0 .75rem;color:var(--text-secondary);font-size:.85rem}.manual-actions{display:grid;grid-template-columns:1fr 1fr;gap:.65rem}.controls{min-width:0}.section{margin-bottom:1rem}.section p{color:var(--text-secondary);font-size:.875rem;line-height:1.55}.section label{display:grid;grid-template-columns:170px 1fr;align-items:center;gap:1rem;padding:.65rem 0}.section label.toggle-row input{width:1.2rem;height:1.2rem;justify-self:start}.section select,.section input[type=number]{padding:.7rem;border:1px solid var(--border-light);border-radius:var(--radius-md);background:var(--bg-secondary);color:var(--text-primary)}button{border:0;border-radius:var(--radius-md);padding:.7rem 1rem;background:var(--accent);color:white;font-weight:600;cursor:pointer}.exit{background:var(--color-error)}button:disabled{opacity:.45;cursor:not-allowed}.save{float:right}.notice{color:var(--color-success);font-weight:600}@media(max-width:900px){.presence-layout{grid-template-columns:1fr}.preview-panel{position:static}.preview{height:420px}}@media(max-width:600px){.section label{grid-template-columns:1fr}.save{float:none;width:100%}}
</style>
