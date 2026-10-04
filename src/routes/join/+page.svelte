<script lang="ts">
	import { enhance } from '$app/forms';
	import Alert from '#lib/components/ui/Alert.svelte';
	import Button from '#lib/components/ui/Button.svelte';
	import Field from '#lib/components/ui/Field.svelte';
	import Panel from '#lib/components/ui/Panel.svelte';
	import PageHeader from '#lib/components/ui/PageHeader.svelte';
	import type { PageProps } from './$types';

	/**
	 * Join — `/join`.
	 */
	let { form }: PageProps = $props();

	let submitting = $state(false);
</script>

<svelte:head>
	<title>Join · kommitly</title>
</svelte:head>

<div class="auth">
	<PageHeader
		title="Join kommitly"
		description="Buyers and sellers back up meetups with a refundable commitment, so people actually show up."
	/>

	<Panel>
		{#if form?.awaitingConfirmation}
			<!--
				Sign-up succeeded but produced no session, because the project
				requires email confirmation. The form is replaced rather than
				annotated: resubmitting now would only report the address as
				taken, which would read as an error when nothing went wrong.
			-->
			<Alert tone="success">
				<strong>Check your email.</strong>
				<p class="confirm-detail">
					A confirmation link is on its way to {form.email}. Open it to finish
					setting up your account, then sign in.
				</p>
			</Alert>
		{:else}
			{#if form?.formError}
				<div class="banner">
					<Alert tone="error">{form.formError}</Alert>
				</div>
			{/if}

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
					<Field
						id="displayName"
						label="Display name"
						hint="Shown to other people on kommitly. Your email is never shown."
						error={form?.errors?.displayName}
					>
						{#snippet children({ id, describedBy, invalid })}
							<input
								{id}
								name="displayName"
								type="text"
								autocomplete="nickname"
								maxlength="60"
								required
								value={form?.displayName ?? ''}
								aria-describedby={describedBy}
								aria-invalid={invalid}
							/>
						{/snippet}
					</Field>

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

					<Field
						id="password"
						label="Password"
						hint="At least 8 characters."
						error={form?.errors?.password}
					>
						{#snippet children({ id, describedBy, invalid })}
							<input
								{id}
								name="password"
								type="password"
								autocomplete="new-password"
								minlength="8"
								required
								aria-describedby={describedBy}
								aria-invalid={invalid}
							/>
						{/snippet}
					</Field>
				</div>

				<!--
					Checked by default. An empty marketplace cannot be evaluated —
					there is nothing to browse and nothing to open — so the useful
					default is to start with something in it. Anyone who wants an
					empty account can clear it.
				-->
				<label class="demo-toggle">
					<input type="checkbox" name="withDemoData" checked />
					<span>
						<strong>Add sample data</strong>
						<span class="demo-detail">
							Five example listings, two meetup locations and some weekly
							availability, so there is something to look at straight away.
						</span>
					</span>
				</label>

				<div class="actions">
					<Button type="submit" disabled={submitting}>
						{submitting ? 'Creating account…' : 'Create account'}
					</Button>
				</div>
			</form>

			<p class="alternate">
				Already have an account? <a href="/signin">Sign in</a>.
			</p>
		{/if}
	</Panel>
</div>

<style>
	.auth {
		max-width: 28rem;
		margin-inline: auto;
	}

	.banner {
		margin-bottom: var(--k-space-4);
	}

	.confirm-detail {
		margin-top: var(--k-space-2);
	}

	.fields {
		display: grid;
		gap: var(--k-space-4);
	}

	.demo-toggle {
		display: flex;
		align-items: flex-start;
		gap: var(--k-space-3);
		margin-top: var(--k-space-5);
		padding: var(--k-space-3);
		background-color: var(--k-surface-raised);
		font-size: var(--k-text-sm);
		cursor: pointer;
	}

	.demo-toggle input {
		/* Nudged to sit on the first line of the label rather than its top. */
		margin-top: 0.2em;
		accent-color: var(--k-primary);
	}

	.demo-detail {
		display: block;
		margin-top: var(--k-space-1);
		color: var(--k-text-muted);
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
