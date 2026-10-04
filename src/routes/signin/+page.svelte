<script lang="ts">
	import { enhance } from '$app/forms';
	import Alert from '#lib/components/ui/Alert.svelte';
	import Button from '#lib/components/ui/Button.svelte';
	import Field from '#lib/components/ui/Field.svelte';
	import Panel from '#lib/components/ui/Panel.svelte';
	import PageHeader from '#lib/components/ui/PageHeader.svelte';
	import type { PageProps } from './$types';

	/**
	 * Sign in — `/signin`.
	 *
	 * `form` holds whatever the action returned on failure: field errors, a
	 * form-level message, and the email so it does not have to be retyped.
	 */
	let { data, form }: PageProps = $props();

	/**
	 * Disables the button and changes its label while the request is in
	 * flight. Without it a slow connection looks like a dead button, and people
	 * submit again.
	 */
	let submitting = $state(false);
</script>

<svelte:head>
	<title>Sign in · kommitly</title>
</svelte:head>

<div class="auth">
	<PageHeader title="Sign in" />

	<Panel>
		{#if data.notice}
			<div class="banner">
				<Alert tone="info">{data.notice}</Alert>
			</div>
		{/if}

		{#if form?.formError}
			<div class="banner">
				<Alert tone="error">{form.formError}</Alert>
			</div>
		{/if}

		<!--
			`use:enhance` submits without a full page reload when JavaScript is
			available. The form still works entirely without it — the action is a
			normal POST — which is why the markup is a real <form> with real
			inputs rather than click handlers.
		-->
		<form
			method="POST"
			use:enhance={() => {
				submitting = true;
				return async ({ update }) => {
					await update();
					submitting = false;
				};
			}}
		>
			<div class="fields">
				<Field id="email" label="Email" error={form?.errors?.email}>
					{#snippet children({ id, describedBy, invalid })}
						<input
							{id}
							name="email"
							type="email"
							autocomplete="email"
							required
							value={form?.email ?? ''}
							aria-describedby={describedBy}
							aria-invalid={invalid}
						/>
					{/snippet}
				</Field>

				<Field id="password" label="Password" error={form?.errors?.password}>
					{#snippet children({ id, describedBy, invalid })}
						<input
							{id}
							name="password"
							type="password"
							autocomplete="current-password"
							required
							aria-describedby={describedBy}
							aria-invalid={invalid}
						/>
					{/snippet}
				</Field>
			</div>

			<div class="actions">
				<Button type="submit" disabled={submitting}>
					{submitting ? 'Signing in…' : 'Sign in'}
				</Button>
			</div>
		</form>

		<p class="alternate">
			No account yet? <a href="/join">Create one</a>.
		</p>
	</Panel>
</div>

<style>
	.auth {
		/* A form this short should not stretch across a desktop monitor —
		   long input lines are harder to scan and look unfinished. */
		max-width: 28rem;
		margin-inline: auto;
	}

	.banner {
		margin-bottom: var(--k-space-4);
	}

	.fields {
		display: grid;
		gap: var(--k-space-4);
	}

	.actions {
		margin-top: var(--k-space-5);
	}

	.alternate {
		margin-top: var(--k-space-5);
		padding-top: var(--k-space-4);
		border-top: var(--k-line-width) solid var(--k-line);
		color: var(--k-text-muted);
		font-size: var(--k-text-sm);
	}
</style>
