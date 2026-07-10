/**
 * Resolve the latest published version of an npm package via jsDelivr's data
 * API (CORS-enabled, and the same CDN the viewer assets are served from).
 */
export async function fetchLatestVersion(pkg: string): Promise<string> {
	const res = await fetch(`https://data.jsdelivr.com/v1/packages/npm/${pkg}`);
	if (!res.ok) {
		throw new Error(`npm package "${pkg}" not found`);
	}
	const data: { tags?: Record<string, string> } = await res.json();
	const latest = data.tags?.latest;
	if (!latest) {
		throw new Error(`No "latest" tag found for "${pkg}"`);
	}
	return latest;
}

/**
 * Extract the npm package and version from a CDN URL like
 * "//cdn.jsdelivr.net/npm/powergrid-viewer@1.9.8/dist/…" (scoped packages too).
 */
export function parseNpmUrl(url: string | undefined): { pkg: string; version: string } | null {
	const m = url?.match(/\/npm\/((?:@[^/@]+\/)?[^/@]+)@([^/]+)\//);
	return m ? { pkg: m[1], version: m[2] } : null;
}

/** Replace every "<pkg>@<any version>" occurrence in a URL with the given version. */
export function setNpmVersion(url: string, pkg: string, version: string): string {
	const escaped = pkg.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	return url.replace(new RegExp(`(${escaped})@[^/]+`, "g"), `$1@${version}`);
}
