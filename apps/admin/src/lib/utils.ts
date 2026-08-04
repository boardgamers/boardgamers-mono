/**
 * Split a boardgame label into its leading emoji and the remaining name.
 * Labels are stored as "<emoji> <Name>" but spacing is inconsistent (sometimes
 * no space after the emoji), so this normalizes to a guaranteed single space.
 *   " 🌏 Gaia Project" -> { emoji: "🌏", name: "Gaia Project" }
 *   "⚡️ Powergrid"      -> { emoji: "⚡️", name: "Powergrid" }
 */
export function gameLabelParts(label: string | undefined): { emoji: string; name: string } {
	if (!label) return { emoji: "", name: "" };
	const trimmed = label.trim();
	const space = trimmed.indexOf(" ");
	if (space <= 0) return { emoji: "", name: trimmed };
	return { emoji: trimmed.slice(0, space), name: trimmed.slice(space + 1).trim() };
}

/** Convenience: just the emoji part of a boardgame label. */
export function gameEmoji(label: string | undefined): string {
	return gameLabelParts(label).emoji;
}

/**
 * Base URL of the public site, derived from the admin host
 * (admin.boardgamers.space → boardgamers.space). In dev, override with
 * VITE_web_host (host or host:port, e.g. "127.0.0.1:8612").
 */
export function webHost(): string {
	const devHost = import.meta.env.VITE_web_host;
	if (devHost) {
		return `http://${devHost}`;
	}
	if (location.hostname === "localhost" || /^\\d{1,3}(\\.\\d{1,3}){3}$/.test(location.hostname)) {
		return "http://localhost:8612";
	}
	return `//${location.hostname.replace(/^admin\\./, "")}`;
}

export function timeAgo(iso?: string): string {
	if (!iso) return "never";
	const diff = Date.now() - new Date(iso).getTime();
	const sec = Math.floor(diff / 1000);
	if (sec < 60) return `${sec}s ago`;
	const min = Math.floor(sec / 60);
	if (min < 60) return `${min}m ago`;
	const hr = Math.floor(min / 60);
	if (hr < 24) return `${hr}h ago`;
	const day = Math.floor(hr / 24);
	if (day < 30) return `${day}d ago`;
	const mon = Math.floor(day / 30);
	return `${mon}mo ago`;
}

export function filesize(bytes: number): string {
	if (bytes < 1000) return `${bytes} B`;
	if (bytes < 1000 * 1000) return `${(bytes / 1000).toFixed(1)} kB`;
	if (bytes < 1000 * 1000 * 1000) return `${(bytes / (1000 * 1000)).toFixed(1)} MB`;
	return `${(bytes / (1000 * 1000 * 1000)).toFixed(1)} GB`;
}
