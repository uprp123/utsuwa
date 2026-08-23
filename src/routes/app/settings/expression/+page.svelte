<script lang="ts">
	import { vrmStore, type ExpressionSettings } from '$lib/stores/vrm.svelte';
	import VrmScene from '$lib/components/vrm/VrmScene.svelte';
	import { getPuppetExpressionNames, resolvePuppetExpression } from '$lib/services/puppet/expressions';
	const labels: Record<string, string> = { happy:'笑顔', sad:'悲しい', angry:'怒り', surprised:'驚き', relaxed:'リラックス' };
	let names = $derived(getPuppetExpressionNames(vrmStore.availableExpressions).filter((name) => name !== 'neutral'));
	function copySettings(source: ExpressionSettings): ExpressionSettings {
		return {
			strengths: Object.fromEntries(Object.entries(source.strengths).map(([name, value]) => [name, Number(value)])),
			happyBlink: Number(source.happyBlink),
			fadeIn: Number(source.fadeIn),
			fadeOut: Number(source.fadeOut)
		};
	}
	let draft = $state<ExpressionSettings>(copySettings(vrmStore.expressionSettings));
	$effect(() => { for (const name of names) if (draft.strengths[name] === undefined) draft.strengths[name] = .75; });
	function save() { vrmStore.updateExpressionSettings(copySettings(draft)); }
	function preview(name: string) {
		save();
		const vrmName = resolvePuppetExpression(name, vrmStore.availableExpressions);
		if (vrmName) vrmStore.flashExpression(vrmName, draft.strengths[name] ?? .75, 3500);
	}
</script>

<div class="page">
	<header class="page-header"><h2>表情設定</h2><p>現在のVRMモデル専用の設定として保存されます。</p></header>
	<div class="expression-layout">
		<aside class="preview-panel">
			<div class="preview"><VrmScene centered locked /></div>
			<p>「確認」を押すと、このモデルで約3.5秒間プレビューします。</p>
		</aside>
		<div class="controls">
	<section class="section">
		<h3>表情の強さ</h3>
		<p class="help">0は表情なし、1はモデルに登録された表情を100%適用します。顔の動きを大きく作り直す設定ではなく、VRM制作者が登録した笑顔・悲しみなどを、どの程度混ぜるかを調整する値です。</p>
		{#each names as name}
			<div class="row"><span>{labels[name.toLowerCase()] ?? name}</span><input aria-label={`${name}の強さ`} type="range" min="0" max="1" step="0.05" bind:value={draft.strengths[name]} /><span>{Number(draft.strengths[name]).toFixed(2)}</span><button onclick={() => preview(name)}>確認</button></div>
		{/each}
	</section>
	<section class="section">
		<h3>笑顔時の目閉じ</h3>
		<p class="help">笑顔と同時に、モデルのまばたき表情を追加します。モデル側の笑顔がまばたきを無効化する設定でも、確認中と実際の会話中はこの値を優先します。</p>
		<div class="row"><span>目を閉じる強さ</span><input aria-label="目を閉じる強さ" type="range" min="0" max="1" step="0.05" bind:value={draft.happyBlink} /><span>{Number(draft.happyBlink).toFixed(2)}</span><button onclick={() => preview('happy')}>確認</button></div>
	</section>
	<section class="section">
		<h3>切り替え速度</h3>
		<div class="row"><span>表情になるまで（秒）</span><input aria-label="表情になるまでの秒数" type="number" min="0.05" step="0.05" bind:value={draft.fadeIn} /></div>
		<div class="row"><span>元へ戻るまで（秒）</span><input aria-label="元へ戻るまでの秒数" type="number" min="0.05" step="0.05" bind:value={draft.fadeOut} /></div>
	</section>
	<button class="save" onclick={save}>設定を保存</button>
		</div>
	</div>
</div>

<style>
	@import '../settings-page.css';
	.page{z-index:1}.expression-layout{display:grid;grid-template-columns:minmax(300px,38%) 1fr;gap:1rem;align-items:start}.preview-panel{position:sticky;top:0}.preview{height:520px;background:var(--bg-secondary);border-radius:var(--radius-lg);overflow:hidden;box-shadow:var(--shadow-sm)}.preview-panel p,.help{color:var(--text-secondary);font-size:.86rem;line-height:1.55}.controls{min-width:0}.section{margin-bottom:1rem}.row{display:grid;grid-template-columns:180px 1fr 55px 70px;gap:.75rem;align-items:center;padding:.55rem 0}.row input[type=number]{padding:.6rem;background:var(--bg-secondary);color:var(--text-primary);border:1px solid var(--border-light);border-radius:var(--radius-md)}button{border:0;border-radius:var(--radius-md);padding:.6rem .8rem;background:var(--accent);color:white;font-weight:600;cursor:pointer}.save{float:right;padding:.75rem 1.2rem}@media(max-width:900px){.expression-layout{grid-template-columns:1fr}.preview-panel{position:static}.preview{height:420px}}@media(max-width:650px){.row{grid-template-columns:1fr}.save{float:none;width:100%}}
</style>
