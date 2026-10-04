<script lang="ts">
	import type { IconDefinition } from '@fortawesome/free-solid-svg-icons';

	/**
	 * Icon — a Font Awesome Free icon, drawn as inline SVG.
	 *
	 * Rendered from the icon's own path data rather than the Font Awesome web
	 * font or its runtime, so nothing loads from a third party, only the icons
	 * actually used reach the bundle, and the icon takes `currentColor`.
	 *
	 * Decorative by default. Pass `label` when the icon is the only thing
	 * conveying its meaning.
	 */
	interface Props {
		icon: IconDefinition;
		label?: string;
	}

	let { icon, label }: Props = $props();

	const [width, height, , , path] = $derived(icon.icon);
	const paths = $derived(Array.isArray(path) ? path : [path]);
</script>

<svg
	class="icon"
	viewBox="0 0 {width} {height}"
	role={label ? 'img' : undefined}
	aria-label={label}
	aria-hidden={label ? undefined : 'true'}
	focusable="false"
>
	{#each paths as d, i (i)}
		<path {d} />
	{/each}
</svg>

<style>
	.icon {
		width: 1em;
		height: 1em;
		fill: currentColor;
		vertical-align: -0.125em;
	}
</style>
