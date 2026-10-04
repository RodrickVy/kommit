<script lang="ts">
	import { enhance } from '$app/forms';
	import Button from '#lib/components/ui/Button.svelte';

	/**
	 * "I'm here" — asks the browser where it is, then submits.
	 *
	 * WHY THIS NEEDS JAVASCRIPT, AND WHY THAT IS NOT A REGRESSION
	 * -----------------------------------------------------------
	 * Every other action in kommitly works as a plain form post. This one
	 * cannot: a device's position is only available through the Geolocation
	 * API, which is a browser call with a permission prompt attached. There is
	 * no server-side equivalent and no HTML control that produces coordinates.
	 *
	 * So the button asks first and submits second, carrying the result in hidden
	 * fields. With scripting off the button does nothing, which is honest —
	 * there is nothing it could do.
	 *
	 * THE POSITION IS NOT TRUSTED. These values are user-supplied and trivially
	 * forgeable; `check_in` compares them against the agreed location and
	 * refuses anything outside the configured radius. This component's job is
	 * only to obtain them and say what is happening while it does.
	 */

	interface Props {
		/** Form action that performs the check-in. */
		action: string;

		/** Label, which differs between the first attempt and a retry. */
		label?: string;
	}

	let { action, label = 'Check in' }: Props = $props();

	type Phase = 'idle' | 'locating' | 'submitting';

	let phase = $state<Phase>('idle');
	let locationError = $state<string | null>(null);

	let form: HTMLFormElement;
	let latitude = $state('');
	let longitude = $state('');

	/**
	 * A single reading, at the best accuracy the device will give.
	 *
	 * `enableHighAccuracy` asks for GPS rather than a network-derived guess,
	 * which matters at this scale: a wifi-based fix can be hundreds of metres
	 * out, and the permitted radius is measured in hundreds of metres.
	 *
	 * The timeout is generous because a cold GPS fix genuinely takes that long
	 * outdoors, and failing early would tell someone standing in the right
	 * place that they were not.
	 */
	const GEOLOCATION_OPTIONS: PositionOptions = {
		enableHighAccuracy: true,
		timeout: 20_000,

		/**
		 * Zero: never reuse a cached position. A fix from an hour ago, at home,
		 * would check someone in to a meetup they have not travelled to.
		 */
		maximumAge: 0
	};

	/** Each failure gets its own sentence, because each has a different remedy. */
	function describe(error: GeolocationPositionError): string {
		switch (error.code) {
			case error.PERMISSION_DENIED:
				return 'Location access was denied. Allow it for this site in your browser settings, then try again.';
			case error.POSITION_UNAVAILABLE:
				return 'Your device could not determine where it is. Step outside or into the open and try again.';
			case error.TIMEOUT:
				return 'Finding your location took too long. Try again — it is usually quicker on the second attempt.';
			default:
				return 'Your location could not be read. Try again.';
		}
	}

	async function checkIn() {
		locationError = null;

		if (!('geolocation' in navigator)) {
			locationError = 'This browser cannot report its location, so checking in is not possible here.';
			return;
		}

		phase = 'locating';

		try {
			const position = await new Promise<GeolocationPosition>((resolve, reject) => {
				navigator.geolocation.getCurrentPosition(resolve, reject, GEOLOCATION_OPTIONS);
			});

			latitude = String(position.coords.latitude);
			longitude = String(position.coords.longitude);

			phase = 'submitting';

			/**
			 * `requestSubmit`, not `submit`. The latter bypasses the submit event,
			 * which is what `use:enhance` listens to — so the page would do a full
			 * reload and lose the progressive-enhancement behaviour.
			 */
			form.requestSubmit();
		} catch (cause) {
			phase = 'idle';
			locationError = describe(cause as GeolocationPositionError);
		}
	}
</script>

<form
	bind:this={form}
	method="POST"
	{action}
	use:enhance={() =>
		async ({ update }) => {
			await update();
			phase = 'idle';
		}}
>
	<input type="hidden" name="latitude" value={latitude} />
	<input type="hidden" name="longitude" value={longitude} />

	<!--
		type="button": the click asks for a location first, and only submits once
		it has one. A submit button would post empty coordinates.
	-->
	<Button type="button" onclick={checkIn} disabled={phase !== 'idle'}>
		{#if phase === 'locating'}
			Checking location…
		{:else if phase === 'submitting'}
			Checking in…
		{:else}
			{label}
		{/if}
	</Button>
</form>

{#if locationError}
	<p class="error" role="alert">{locationError}</p>
{/if}

<style>
	.error {
		margin-top: var(--k-space-3);
		color: var(--k-danger);
		font-size: var(--k-text-sm);
	}
</style>
