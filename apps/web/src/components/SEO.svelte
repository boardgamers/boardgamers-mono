<script lang="ts">
	import { page } from "$app/state";
	import { absoluteUrl, defaultDescription, defaultOgImage, siteName } from "@/lib/seo";

	let {
		title = siteName,
		description = defaultDescription,
		image = undefined,
		imageWidth = undefined,
		imageHeight = undefined,
		type = "website",
		noindex = false,
	}: {
		title?: string;
		description?: string;
		image?: string | undefined;
		imageWidth?: number | undefined;
		imageHeight?: number | undefined;
		type?: "website" | "article" | "profile";
		noindex?: boolean;
	} = $props();

	// Pages get the default share image unless they pass their own; noindex pages get none.
	const ogImage = $derived(noindex ? undefined : (image ?? defaultOgImage.path));
	const ogImageWidth = $derived(image ? imageWidth : defaultOgImage.width);
	const ogImageHeight = $derived(image ? imageHeight : defaultOgImage.height);
</script>

<svelte:head>
	<title>{title}</title>
	<meta name="description" content={description} />
	{#if noindex}
		<meta name="robots" content="noindex, nofollow" />
	{/if}
	<link rel="canonical" href={page.url.origin + page.url.pathname} />

	<meta property="og:site_name" content={siteName} />
	<meta property="og:type" content={type} />
	<meta property="og:title" content={title} />
	<meta property="og:description" content={description} />
	<meta property="og:url" content={page.url.origin + page.url.pathname} />
	{#if ogImage}
		<meta property="og:image" content={absoluteUrl(page.url.origin, ogImage)} />
		{#if ogImageWidth}
			<meta property="og:image:width" content={String(ogImageWidth)} />
		{/if}
		{#if ogImageHeight}
			<meta property="og:image:height" content={String(ogImageHeight)} />
		{/if}
	{/if}

	<meta name="twitter:card" content={ogImage ? "summary_large_image" : "summary"} />
	<meta name="twitter:title" content={title} />
	<meta name="twitter:description" content={description} />
	{#if ogImage}
		<meta name="twitter:image" content={absoluteUrl(page.url.origin, ogImage)} />
	{/if}
</svelte:head>
