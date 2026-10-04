<script lang="ts">
	import { onMount } from 'svelte';
	import { PUBLIC_MAPBOX_TOKEN } from '$app/env/public';
	import 'mapbox-gl/dist/mapbox-gl.css';

	/**
	 * CheckInMap, the meetup spot, the check-in radius around it, and where
	 * this device is right now.
	 *
	 * GUIDANCE ONLY. The distance shown here is computed in the browser to help
	 * someone walk into the circle; `check_in` measures it again on the server
	 * and is the only thing that decides. Renders nothing without a Mapbox token.
	 */
	interface Props {
		latitude: number;
		longitude: number;
		radiusMetres: number;
		name: string;
	}

	let { latitude, longitude, radiusMetres, name }: Props = $props();

	let container = $state<HTMLDivElement>();
	let distance = $state<number | null>(null);
	let accuracy = $state<number | null>(null);
	let positionError = $state<string | null>(null);

	const inside = $derived(distance !== null && distance <= radiusMetres);

	/** Great-circle distance in metres, the same haversine the server uses. */
	function metresBetween(lat1: number, lon1: number, lat2: number, lon2: number): number {
		const toRad = (deg: number) => (deg * Math.PI) / 180;
		const dLat = toRad(lat2 - lat1);
		const dLon = toRad(lon2 - lon1);
		const a =
			Math.sin(dLat / 2) ** 2 +
			Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
		return 6_371_008.8 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
	}

	/** A circle as a 64-sided polygon, since GeoJSON has no circle type. */
	function circle(lat: number, lon: number, metres: number) {
		const points: [number, number][] = [];
		const dLat = metres / 111_320;
		const dLon = metres / (111_320 * Math.cos((lat * Math.PI) / 180));
		for (let i = 0; i <= 64; i++) {
			const theta = (i / 64) * 2 * Math.PI;
			points.push([lon + dLon * Math.cos(theta), lat + dLat * Math.sin(theta)]);
		}
		return {
			type: 'Feature' as const,
			properties: {},
			geometry: { type: 'Polygon' as const, coordinates: [points] }
		};
	}

	function formatDistance(metres: number): string {
		return metres < 1000 ? `${Math.round(metres)} m` : `${(metres / 1000).toFixed(1)} km`;
	}

	onMount(() => {
		if (!PUBLIC_MAPBOX_TOKEN) return;

		let watchId: number | null = null;
		let disposed = false;
		let cleanupMap = () => {};

		/** Loaded on demand: mapbox-gl touches `window` and is large. */
		import('mapbox-gl').then(({ default: mapboxgl }) => {
			if (disposed) return;

			mapboxgl.accessToken = PUBLIC_MAPBOX_TOKEN!;

			if (!container) return;

			const map = new mapboxgl.Map({
				container,
				style: 'mapbox://styles/mapbox/streets-v12',
				center: [longitude, latitude],
				zoom: 15.5,
				attributionControl: true
			});
			cleanupMap = () => map.remove();

			map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), 'top-right');

			new mapboxgl.Marker({ color: '#1f6f63' })
				.setLngLat([longitude, latitude])
				.setPopup(new mapboxgl.Popup({ offset: 24 }).setText(name))
				.addTo(map);

			const me = document.createElement('div');
			me.className = 'me-dot';
			const meMarker = new mapboxgl.Marker({ element: me });
			let fitted = false;

			map.on('load', () => {
				map.addSource('radius', { type: 'geojson', data: circle(latitude, longitude, radiusMetres) });
				map.addLayer({
					id: 'radius-fill',
					type: 'fill',
					source: 'radius',
					paint: { 'fill-color': '#1f6f63', 'fill-opacity': 0.15 }
				});
				map.addLayer({
					id: 'radius-line',
					type: 'line',
					source: 'radius',
					paint: { 'line-color': '#1f6f63', 'line-width': 2 }
				});
			});

			if (!('geolocation' in navigator)) {
				positionError = 'This browser cannot report its location.';
				return;
			}

			watchId = navigator.geolocation.watchPosition(
				(position) => {
					const { latitude: lat, longitude: lon } = position.coords;
					positionError = null;
					accuracy = position.coords.accuracy;
					distance = metresBetween(lat, lon, latitude, longitude);
					meMarker.setLngLat([lon, lat]).addTo(map);

					/** Frame both points once, then leave the map to the user. */
					if (!fitted) {
						fitted = true;
						const bounds = new mapboxgl.LngLatBounds([longitude, latitude], [longitude, latitude]);
						bounds.extend([lon, lat]);
						map.fitBounds(bounds, { padding: 60, maxZoom: 16, duration: 0 });
					}
				},
				(error) => {
					positionError =
						error.code === error.PERMISSION_DENIED
							? 'Allow location access to see how far you are from the spot.'
							: 'Your location could not be read yet.';
				},
				{ enableHighAccuracy: true, maximumAge: 0, timeout: 20_000 }
			);
		});

		return () => {
			disposed = true;
			if (watchId !== null) navigator.geolocation.clearWatch(watchId);
			cleanupMap();
		};
	});

	const directions = $derived(
		`https://www.google.com/maps/dir/?api=1&destination=${latitude},${longitude}`
	);
</script>

{#if PUBLIC_MAPBOX_TOKEN}
	<div class="wrap">
		<div class="map k-cut" bind:this={container} role="img" aria-label="Map of {name}"></div>

		<div class="status" data-inside={inside}>
			{#if distance !== null}
				<span class="dot" aria-hidden="true"></span>
				{#if inside}
					You are inside the check-in area ({formatDistance(distance)} away).
				{:else}
					You are {formatDistance(distance)} away, get within {radiusMetres} m to check in.
				{/if}
				{#if accuracy !== null && accuracy > 50}
					<span class="muted">GPS accuracy ±{Math.round(accuracy)} m.</span>
				{/if}
			{:else if positionError}
				<span class="muted">{positionError}</span>
			{:else}
				<span class="muted">Finding your location…</span>
			{/if}
		</div>

		<a class="directions" href={directions} target="_blank" rel="noopener noreferrer">
			Get directions
		</a>
	</div>
{/if}

<style>
	.wrap {
		display: grid;
		gap: var(--k-space-2);
		margin-top: var(--k-space-4);
	}

	.map {
		width: 100%;
		height: 18rem;
		background-color: var(--k-surface-sunken);
	}

	.status {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--k-space-2);
		font-size: var(--k-text-sm);
	}

	.dot {
		width: 0.5rem;
		height: 0.5rem;
		background-color: var(--k-warning);
	}

	.status[data-inside='true'] .dot {
		background-color: var(--k-success);
	}

	.muted {
		color: var(--k-text-subtle);
	}

	.directions {
		justify-self: start;
		font-size: var(--k-text-sm);
	}

	/* The "you are here" marker. Global because mapbox-gl owns the element. */
	:global(.me-dot) {
		width: 16px;
		height: 16px;
		border: 3px solid #fff;
		border-radius: 50%;
		background-color: #2563eb;
		box-shadow: 0 0 0 2px rgb(37 99 235 / 0.35);
	}
</style>
