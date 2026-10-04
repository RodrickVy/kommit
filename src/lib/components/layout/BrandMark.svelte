<script lang="ts">
	/**
	 * BrandMark — the kommitly logotype.
	 *
	 * A chamfered teal tile holding a lowercase "k", followed by the
	 * wordmark. Used in the header and the footer; it is a component rather
	 * than duplicated markup so the two can never disagree.
	 *
	 * Purely presentational — it renders no link. The caller decides where it
	 * points, which is what lets the header wrap it in a link to `/` while
	 * the footer renders it as plain text.
	 */
	interface Props {
		/**
		 * `md` for the header, `sm` where the mark is a secondary detail.
		 */
		size?: 'sm' | 'md';

		/**
		 * Whether to show the "kommitly" wordmark next to the tile. Set to
		 * `false` for a very narrow container, where the tile alone still
		 * identifies the app.
		 */
		showWordmark?: boolean;
	}

	let { size = 'md' }: Props = $props();
</script>

<span class="brand" data-size={size}>
 
	 
	<img class="wordmark" src="/logo.png" alt="kommitly" />
	 
</span>

<style>
	.brand{
		padding: 1rem;
		display: inline;
		margin:0px 0 20px 20px ;


	}

	.brand img{
		width:60px;
		display: inline;


	}
</style>