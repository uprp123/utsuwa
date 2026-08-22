<script lang="ts">
	import { MOTION_SLOTS, vrmStore } from '$lib/stores/vrm.svelte';
	import { goto } from '$app/navigation';
	import { localPath } from '$lib/config/links';
	let error = $state<string | null>(null);
	let notice = $state<string | null>(null);
	let importing = $state(false);

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
		<h2>Motion</h2>
		<p>Import VRMA files and assign them to idle or talking motion.</p>
	</header>

	<section class="section import-section">
		<div>
			<h3>Custom VRMA</h3>
			<p>Files are stored locally in Utsuwa and remain available after restart.</p>
		</div>
		<label class="import-button" class:disabled={importing}>
			{importing ? 'Importing…' : 'Import .vrma'}
			<input type="file" accept=".vrma,.VRMA" multiple onchange={importFiles} disabled={importing} />
		</label>
	</section>

	<section class="section backup-section">
		<div>
			<h3>Motion backup</h3>
			<p>Exports VRMA files, idle choices, random idles, and every AI motion assignment into one file.</p>
		</div>
		<div class="backup-actions">
			<button type="button" onclick={exportBackup} disabled={importing}>Export backup</button>
			<label class="import-button" class:disabled={importing}>
				Import backup
				<input type="file" accept=".json,application/json" onchange={importBackup} disabled={importing} />
			</label>
		</div>
	</section>

	{#if error}<p class="error">{error}</p>{/if}
	{#if notice}<p class="notice">{notice}</p>{/if}

	<section class="section assignments">
		<h3>Assignments</h3>
		<label>
			<span>Idle motion</span>
			<select value={vrmStore.activeIdleAnimationId ?? ''} onchange={(e) => vrmStore.setIdleAnimation(e.currentTarget.value || null)}>
				<option value="">Built-in random idle</option>
				{#each vrmStore.customAnimations as motion}<option value={motion.id}>{motion.name}</option>{/each}
			</select>
		</label>
		<label>
			<span>Talking motion</span>
			<select value={vrmStore.activeTalkingAnimationId ?? ''} onchange={(e) => vrmStore.setTalkingAnimation(e.currentTarget.value || null)}>
				<option value="">Built-in talking motion</option>
				{#each vrmStore.customAnimations as motion}<option value={motion.id}>{motion.name}</option>{/each}
			</select>
		</label>
	</section>

	<section class="section random-idles">
		<h3>Random idle motions</h3>
		<p>Selected motions are mixed into the idle rotation. After each one, Utsuwa continues with another idle motion.</p>
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
		<h3>AI motion mapping</h3>
		<p>Map motion names sent by AICommentViewer to imported VRMA files.</p>
		{#each MOTION_SLOTS as slot}
			<label>
				<span>{slot}</span>
				<select value={vrmStore.motionAssignments[slot] ?? ''} onchange={(e) => vrmStore.setMotionAssignment(slot, e.currentTarget.value || null)}>
					<option value="">No motion</option>
					{#each vrmStore.customAnimations as motion}<option value={motion.id}>{motion.name}</option>{/each}
				</select>
			</label>
		{/each}
	</section>

	<section class="section library">
		<h3>Imported motions</h3>
		{#if vrmStore.customAnimations.length === 0}
			<p class="empty">No custom motion imported yet.</p>
		{:else}
			{#each vrmStore.customAnimations as motion}
				<div class="motion-row">
					<div><strong>{motion.name}</strong><small>VRMA</small></div>
					<div class="actions">
						<button type="button" onclick={() => previewMotion(motion.id)}>Preview once</button>
						<button class="danger" type="button" onclick={() => vrmStore.removeAnimation(motion.id)}>Remove</button>
					</div>
				</div>
			{/each}
		{/if}
	</section>
</div>

<style>
	@import '../settings-page.css';
	.page{z-index:1}.section{margin-bottom:1rem}.section h3{margin:0 0 .35rem}.section p{margin:.2rem 0;color:var(--text-secondary);font-size:.875rem}.import-section,.backup-section{display:flex;align-items:center;justify-content:space-between;gap:1rem}.backup-actions{display:flex;gap:.5rem;flex-shrink:0}.import-button,button{border:0;border-radius:var(--radius-md);padding:.65rem .9rem;background:var(--accent);color:white;font-weight:600;cursor:pointer}.import-button input{display:none}.import-button.disabled,button:disabled{opacity:.6;pointer-events:none}.assignments{display:grid;gap:1rem}.assignments label{display:grid;grid-template-columns:150px 1fr;align-items:center;gap:1rem}.assignments span{font-weight:600}.assignments select{padding:.7rem;border:1px solid var(--border-light);border-radius:var(--radius-md);background:var(--bg-secondary);color:var(--text-primary)}.check-list{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:.55rem;margin-top:1rem}.check-list label{display:flex;align-items:center;gap:.55rem;padding:.65rem;background:var(--bg-secondary);border-radius:var(--radius-md)}.check-list input{width:1.1rem;height:1.1rem}.motion-row{display:flex;align-items:center;justify-content:space-between;gap:1rem;padding:.85rem 0;border-bottom:1px solid var(--border-light)}.motion-row:last-child{border-bottom:0}.motion-row div:first-child{display:flex;flex-direction:column;gap:.2rem}.motion-row small{color:var(--text-tertiary)}.actions{display:flex;gap:.5rem}.actions .danger{background:var(--color-error)}.empty{padding:1rem 0}.error{color:var(--color-error);font-weight:600}.notice{color:var(--color-success);font-weight:600}@media(max-width:640px){.import-section,.backup-section,.motion-row{align-items:stretch;flex-direction:column}.backup-actions{flex-wrap:wrap}.assignments label{grid-template-columns:1fr}.actions button{flex:1}}
</style>
