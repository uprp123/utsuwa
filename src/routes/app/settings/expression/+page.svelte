<script lang="ts">
	import { vrmStore, type ExpressionSettings } from '$lib/stores/vrm.svelte';
	const names = [['happy','笑顔'],['sad','悲しい'],['angry','怒り'],['surprised','驚き'],['relaxed','リラックス']] as const;
	let draft = $state<ExpressionSettings>(structuredClone(vrmStore.expressionSettings));
	function save() { vrmStore.updateExpressionSettings(structuredClone(draft)); }
	function preview(name: string) { save(); vrmStore.flashExpression(name, draft.strengths[name] ?? .75, 3500); }
</script>

<div class="page">
	<header class="page-header"><h2>表情設定</h2><p>現在のVRMモデル専用の設定として保存されます。</p></header>
	<section class="section">
		<h3>表情の強さ</h3>
		{#each names as [name,label]}
			<div class="row"><span>{label}</span><input aria-label={`${label}の強さ`} type="range" min="0" max="1" step="0.05" bind:value={draft.strengths[name]} /><span>{Number(draft.strengths[name]).toFixed(2)}</span><button onclick={() => preview(name)}>確認</button></div>
		{/each}
	</section>
	<section class="section">
		<h3>笑顔時の目閉じ</h3>
		<div class="row"><span>目を閉じる強さ</span><input aria-label="目を閉じる強さ" type="range" min="0" max="1" step="0.05" bind:value={draft.happyBlink} /><span>{Number(draft.happyBlink).toFixed(2)}</span><button onclick={() => preview('happy')}>確認</button></div>
	</section>
	<section class="section">
		<h3>切り替え速度</h3>
		<div class="row"><span>表情になるまで（秒）</span><input aria-label="表情になるまでの秒数" type="number" min="0.05" step="0.05" bind:value={draft.fadeIn} /></div>
		<div class="row"><span>元へ戻るまで（秒）</span><input aria-label="元へ戻るまでの秒数" type="number" min="0.05" step="0.05" bind:value={draft.fadeOut} /></div>
	</section>
	<button class="save" onclick={save}>設定を保存</button>
</div>

<style>
	@import '../settings-page.css';
	.page{z-index:1}.section{margin-bottom:1rem}.row{display:grid;grid-template-columns:180px 1fr 55px 70px;gap:.75rem;align-items:center;padding:.55rem 0}.row input[type=number]{padding:.6rem;background:var(--bg-secondary);color:var(--text-primary);border:1px solid var(--border-light);border-radius:var(--radius-md)}button{border:0;border-radius:var(--radius-md);padding:.6rem .8rem;background:var(--accent);color:white;font-weight:600;cursor:pointer}.save{float:right;padding:.75rem 1.2rem}@media(max-width:650px){.row{grid-template-columns:1fr}.save{float:none;width:100%}}
</style>
