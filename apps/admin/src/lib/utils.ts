export function filesize(bytes: number): string {
	if (bytes < 1000) return `${bytes} B`;
	if (bytes < 1000 * 1000) return `${(bytes / 1000).toFixed(1)} kB`;
	if (bytes < 1000 * 1000 * 1000) return `${(bytes / (1000 * 1000)).toFixed(1)} MB`;
	return `${(bytes / (1000 * 1000 * 1000)).toFixed(1)} GB`;
}
