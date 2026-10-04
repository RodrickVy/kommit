<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import { deserialize } from '$app/forms';
	import Alert from '#lib/components/ui/Alert.svelte';
	import { ACCEPTED_IMAGE_TYPES, MAX_IMAGE_BYTES } from '#lib/listings/images';

	/**
	 * ImageUploader, uploads listing photographs one at a time, with progress.
	 *
	 * WHY XHR AND NOT `fetch`
	 * -----------------------
	 * `fetch` cannot report upload progress. There is no event for bytes sent,
	 * so a fetch-based uploader can only show an indeterminate spinner and hope.
	 * `XMLHttpRequest` exposes `upload.onprogress`, which is the only way in a
	 * browser to tell someone their 6 MB photograph is 40% of the way up a slow
	 * connection.
	 *
	 * WHY ONE REQUEST PER FILE
	 * ------------------------
	 * A single batched request can only say "something failed". One at a time
	 * means each photograph gets its own progress bar and its own error, so a
	 * seller whose third image is too large keeps the first two and is told
	 * exactly which one to replace.
	 *
	 * Requests go to the page's own `?/uploadImage` action rather than a bespoke
	 * endpoint, so there is a single code path on the server.
	 */

	interface Props {
		/** Shown when no more images may be added; disables the control. */
		disabled?: boolean;
	}

	let { disabled = false }: Props = $props();

	/** One entry per file selected in this session. */
	interface UploadItem {
		id: string;
		name: string;
		/** 0–100 while uploading. */
		progress: number;
		status: 'uploading' | 'done' | 'failed';
		error?: string;
	}

	let items = $state<UploadItem[]>([]);
	let fileInput: HTMLInputElement | null = $state(null);
	let dragging = $state(false);

	const uploading = $derived(items.some((item) => item.status === 'uploading'));

	/**
	 * Rejects a file before it is sent. The server checks all of this again;
	 * this exists purely so a 9 MB photograph fails instantly rather than after
	 * a minute of uploading.
	 */
	function localRejection(file: File): string | null {
		if (!ACCEPTED_IMAGE_TYPES.includes(file.type)) {
			return 'Not a JPEG, PNG, WebP or AVIF image.';
		}
		if (file.size > MAX_IMAGE_BYTES) {
			return 'Larger than 8 MB.';
		}
		return null;
	}

	function uploadOne(file: File, item: UploadItem): Promise<void> {
		return new Promise((resolve) => {
			const request = new XMLHttpRequest();
			const body = new FormData();
			body.set('image', file);

			request.open('POST', '?/uploadImage');
			/** Tells SvelteKit this is a form action call, not a navigation. */
			request.setRequestHeader('x-sveltekit-action', 'true');

			request.upload.addEventListener('progress', (event) => {
				if (event.lengthComputable) {
					item.progress = Math.round((event.loaded / event.total) * 100);
				}
			});

			request.addEventListener('load', () => {
				/**
				 * `deserialize` understands exactly what a form action returns,
				 * including the devalue encoding that `use:enhance` would normally
				 * handle. Parsing it by hand would be guesswork.
				 */
				const result = deserialize(request.responseText);

				if (result.type === 'success') {
					item.status = 'done';
					item.progress = 100;
				} else if (result.type === 'failure') {
					item.status = 'failed';
					item.error = String(result.data?.uploadError ?? 'Upload failed.');
				} else {
					item.status = 'failed';
					item.error = 'Upload failed.';
				}

				resolve();
			});

			request.addEventListener('error', () => {
				item.status = 'failed';
				item.error = 'Lost connection during upload.';
				resolve();
			});

			request.send(body);
		});
	}

	async function handleFiles(files: FileList | null) {
		if (!files || files.length === 0) return;

		for (const file of Array.from(files)) {
			const item: UploadItem = {
				id: crypto.randomUUID(),
				name: file.name,
				progress: 0,
				status: 'uploading'
			};

			const rejection = localRejection(file);

			if (rejection) {
				item.status = 'failed';
				item.error = rejection;
				items = [...items, item];
				continue;
			}

			items = [...items, item];

			/**
			 * Sequential, not parallel. Several large uploads at once compete for
			 * the same upstream bandwidth, so every bar crawls and the set
			 * finishes no sooner. One at a time gives honest progress.
			 */
			await uploadOne(file, item);
		}

		/** Pull the newly attached images into the page. */
		await invalidateAll();

		/**
		 * Clearing the input matters: without it, selecting the same file again
		 * fires no change event, so retrying after a failure would appear to do
		 * nothing at all.
		 */
		if (fileInput) fileInput.value = '';
	}

	function onDrop(event: DragEvent) {
		event.preventDefault();
		dragging = false;
		void handleFiles(event.dataTransfer?.files ?? null);
	}
</script>

<div class="uploader">
	<!--
		A real <label> wrapping a real file input. Clicking anywhere in the drop
		zone opens the picker, keyboard focus works, and the whole thing still
		functions if the drag handlers never fire.
	-->
	<label
		class="dropzone k-cut"
		class:dragging
		ondragover={(event) => {
			event.preventDefault();
			dragging = true;
		}}
		ondragleave={() => (dragging = false)}
		ondrop={onDrop}
	>
		<input
			bind:this={fileInput}
			type="file"
			accept={ACCEPTED_IMAGE_TYPES.join(',')}
			multiple
			{disabled}
			onchange={(event) => handleFiles(event.currentTarget.files)}
		/>
		<span class="dropzone-label">
			{#if disabled}
				This listing already has the maximum number of photographs.
			{:else}
				<strong>Choose photographs</strong>
				<span class="dropzone-hint">
					or drag them here, JPEG, PNG, WebP or AVIF, up to 8 MB each
				</span>
			{/if}
		</span>
	</label>

	{#if items.length > 0}
		<!--
			`aria-live="polite"` announces each completion without interrupting,
			so progress is not a sighted-only feature.
		-->
		<ul class="queue" aria-live="polite">
			{#each items as item (item.id)}
				<li class="queue-item" data-status={item.status}>
					<div class="queue-head">
						<span class="queue-name">{item.name}</span>
						<span class="queue-status">
							{#if item.status === 'uploading'}
								{item.progress}%
							{:else if item.status === 'done'}
								Uploaded
							{:else}
								Failed
							{/if}
						</span>
					</div>

					{#if item.status === 'uploading'}
						<!-- A native progress element, so it is announced as a progress
						     bar rather than as a decorated div. -->
						<progress class="bar" max="100" value={item.progress}></progress>
					{/if}

					{#if item.error}
						<p class="queue-error">{item.error}</p>
					{/if}
				</li>
			{/each}
		</ul>
	{/if}

	{#if uploading}
		<Alert tone="info">Uploading, leaving this page will stop it.</Alert>
	{/if}
</div>

<style>
	.uploader {
		display: grid;
		gap: var(--k-space-4);
	}

	.dropzone {
		display: grid;
		place-items: center;
		padding: var(--k-space-6) var(--k-space-4);
		background-color: var(--k-surface-sunken);
		box-shadow: inset 0 0 0 2px var(--k-line-strong);
		text-align: center;
		cursor: pointer;
		transition: background-color var(--k-duration-fast) var(--k-ease);
	}

	.dropzone.dragging {
		background-color: var(--k-surface-raised);
		box-shadow: inset 0 0 0 2px var(--k-primary);
	}

	/* Hidden visually but still focusable and operable. `display: none` would
	   drop it out of the tab order entirely. */
	.dropzone input {
		position: absolute;
		width: 1px;
		height: 1px;
		opacity: 0;
	}

	.dropzone input:focus-visible + .dropzone-label {
		outline: 2px solid var(--k-focus);
		outline-offset: 4px;
	}

	.dropzone-label {
		display: grid;
		gap: var(--k-space-1);
		font-size: var(--k-text-sm);
	}

	.dropzone-hint {
		color: var(--k-text-subtle);
	}

	.queue {
		display: grid;
		gap: var(--k-space-3);
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.queue-item {
		display: grid;
		gap: var(--k-space-2);
		padding: var(--k-space-3);
		background-color: var(--k-surface-raised);
		font-size: var(--k-text-sm);
	}

	.queue-head {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: var(--k-space-3);
	}

	.queue-name {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.queue-status {
		flex-shrink: 0;
		color: var(--k-text-subtle);
		/* Tabular figures so the percentage does not jiggle as it counts up. */
		font-variant-numeric: tabular-nums;
	}

	.queue-item[data-status='done'] .queue-status {
		color: var(--k-success);
	}

	.queue-item[data-status='failed'] .queue-status {
		color: var(--k-danger);
	}

	.queue-error {
		margin: 0;
		color: var(--k-danger);
	}

	.bar {
		width: 100%;
		height: 0.4rem;
		/* Reset the platform look so the fill can be themed. */
		appearance: none;
		border: 0;
		background-color: var(--k-surface-sunken);
	}

	.bar::-webkit-progress-bar {
		background-color: var(--k-surface-sunken);
	}

	.bar::-webkit-progress-value {
		background-color: var(--k-primary);
	}

	.bar::-moz-progress-bar {
		background-color: var(--k-primary);
	}
</style>
