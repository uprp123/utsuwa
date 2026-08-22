<script lang="ts">
	import { puppetStore } from '$lib/stores/puppet.svelte';
	let draftUrl = $state(puppetStore.url);

	const statusLabels: Record<string, string> = {
		disabled: 'Disabled', connecting: 'Connecting…', connected: 'Connected',
		reconnecting: 'Reconnecting…', error: 'Connection error'
	};

	function saveUrl() {
		if (!/^wss?:\/\//i.test(draftUrl.trim())) return;
		puppetStore.setUrl(draftUrl);
	}
</script>

<div class="settings-page">
	<header>
		<h2>AICommentViewer Puppet</h2>
		<p>Receive AICommentViewer replies directly without sending them through Utsuwa's LLM.</p>
	</header>

	<section class="card">
		<label class="toggle-row">
			<span><strong>Enable Puppet receiver</strong><small>Displays replies and uses the current Utsuwa TTS and lip sync.</small></span>
			<input type="checkbox" checked={puppetStore.enabled} onchange={(e) => puppetStore.setEnabled(e.currentTarget.checked)} />
		</label>

		<div class="field">
			<label for="puppet-url">AICommentViewer WebSocket URL</label>
			<div class="url-row">
				<input id="puppet-url" bind:value={draftUrl} onkeydown={(e) => e.key === 'Enter' && saveUrl()} />
				<button type="button" onclick={saveUrl}>Save & reconnect</button>
			</div>
			<small>Utsuwa dedicated endpoint: ws://127.0.0.1:8768/ws?room=lobby&amp;name=Utsuwa</small>
		</div>

		<div class="status" class:ok={puppetStore.status === 'connected'}>
			<span class="dot"></span>{statusLabels[puppetStore.status]}
		</div>
		{#if puppetStore.lastError}<p class="error">{puppetStore.lastError}</p>{/if}
	</section>

	<section class="card compact">
		<h3>Supported message</h3>
		<code>{'{"type":"chat","text":"[happy]こんにちは"}'}</code>
		<p>The leading emotion tag is removed from the chat text and applied to the VRM expression when available.</p>
	</section>
</div>

<style>
	.settings-page{max-width:820px;overflow:auto;padding:0 .25rem 2rem;z-index:1} header{margin-bottom:1.5rem}h2{margin:0 0 .4rem;font-size:1.65rem}header p,.card p,small{color:var(--text-secondary)}.card{background:var(--bg-primary);border:1px solid var(--border-light);border-radius:var(--radius-lg);padding:1.25rem;margin-bottom:1rem}.toggle-row{display:flex;justify-content:space-between;gap:1rem;align-items:center}.toggle-row span{display:flex;flex-direction:column;gap:.3rem}.toggle-row input{width:1.25rem;height:1.25rem}.field{margin-top:1.4rem}.field>label{display:block;font-weight:600;margin-bottom:.5rem}.url-row{display:flex;gap:.6rem;margin-bottom:.45rem}.url-row input{flex:1;min-width:0;padding:.75rem;border:1px solid var(--border-light);border-radius:var(--radius-md);background:var(--bg-secondary);color:var(--text-primary)}button{padding:.7rem 1rem;border:0;border-radius:var(--radius-md);background:var(--accent);color:white;font-weight:600;cursor:pointer}.status{display:flex;align-items:center;gap:.5rem;margin-top:1.1rem;color:var(--text-secondary)}.dot{width:.65rem;height:.65rem;border-radius:50%;background:var(--text-tertiary)}.status.ok{color:#22a06b}.status.ok .dot{background:#22a06b}.error{color:var(--color-error)!important}.compact h3{margin-top:0}.compact code{display:block;padding:.8rem;background:var(--bg-secondary);border-radius:var(--radius-md);overflow:auto}.compact p{margin-bottom:0;font-size:.9rem}@media(max-width:640px){.url-row{flex-direction:column}}
</style>
