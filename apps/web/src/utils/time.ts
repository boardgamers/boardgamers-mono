export function timerTime(value: number): string {
	const d = new Date();
	const date = new Date(d.setHours(0, 0, 0, 0) - d.getTimezoneOffset() * 60000 + value * 1000);

	return `${date.getHours().toString().padStart(2, "0")}h${
		date.getMinutes() ? date.getMinutes().toString().padStart(2, "0") : ""
	}`;
}

/**
 * timerTime in an explicit IANA timezone instead of the runtime's. The timer
 * start/end are UTC seconds-since-midnight, so only the zone's UTC offset
 * matters. The anchor is TODAY's UTC midnight (not the epoch): formatting
 * `value * 1000` would use the zone's 1970 offset, which is an hour off for
 * zones currently observing DST. Anchoring on the UTC date keeps server and
 * client on the same day regardless of their own zones, so SSR + hydration
 * still agree. Use via viewerTimezone() (src/lib/timezone) so SSR renders in
 * the viewer's zone (from the `tz` cookie) and matches client hydration (#339).
 */
export function timerTimeInTz(value: number, tz: string): string {
	const now = new Date();
	const anchor = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
	const parts = new Intl.DateTimeFormat("en-US", {
		timeZone: tz,
		hour: "2-digit",
		minute: "2-digit",
		hourCycle: "h23",
	}).formatToParts(anchor + value * 1000);
	const hour = parts.find((p) => p.type === "hour")?.value ?? "00";
	const minute = parts.find((p) => p.type === "minute")?.value ?? "00";
	return `${hour}h${minute !== "00" ? minute : ""}`;
}

export function niceDate(date: string | Date): string {
	if (!date) {
		return date as any;
	}
	if (typeof date === "string") {
		if (date.length > 10) {
			const ms = Date.parse(date);

			if (ms) {
				return niceDate(new Date(ms));
			}
			return date;
		}
		if (date.length === 8) {
			return date.substr(6, 2) + "/" + date.substr(4, 2) + "/" + date.substr(2, 2);
		} else {
			return date.substr(8, 2) + "/" + date.substr(5, 2) + "/" + date.substr(2, 2);
		}
	} else {
		return (
			String(date.getDate()).padStart(2, "0") +
			"/" +
			String(date.getMonth() + 1).padStart(2, "0") +
			"/" +
			date.getFullYear().toString().substr(2, 2)
		);
	}
}

const timeRanges = [
	{
		name: "second",
		value: 1,
	},
	{
		name: "minute",
		value: 60,
	},
	{
		name: "hour",
		value: 3600,
	},
	{
		name: "day",
		value: 24 * 3600,
	},
];

export function pluralize(count: number, str: string, { showCount = true } = { showCount: true }): string {
	return showCount ? `${count} ${str}${+count >= 2 ? "s" : ""}` : `${str}${+count >= 2 ? "s" : ""}`;
}

export function duration(seconds: number): string {
	for (let i = 0; i < timeRanges.length; i++) {
		if (i === timeRanges.length - 1 || timeRanges[i + 1].value > seconds) {
			const n = seconds / timeRanges[i].value;
			const gap = timeRanges[i].value;
			if (
				gap < seconds &&
				seconds % gap !== 0 &&
				i > 0 &&
				Math.floor((seconds - gap * Math.floor(n)) / timeRanges[i - 1].value) > 0
			) {
				return (
					pluralize(Math.floor(n), timeRanges[i].name) +
					" " +
					pluralize(Math.floor((seconds - gap * Math.floor(n)) / timeRanges[i - 1].value), timeRanges[i - 1].name)
				);
			}
			return pluralize(Math.floor(n), timeRanges[i].name);
		}
	}

	return ">o>";
}

export function shortDuration(seconds: number): string | undefined {
	for (let i = 0; i < timeRanges.length; i++) {
		if (i === timeRanges.length - 1 || timeRanges[i + 1].value > seconds) {
			const n = seconds / timeRanges[i].value;
			const gap = timeRanges[i].value;
			if (
				gap < seconds &&
				seconds % gap !== 0 &&
				i > 0 &&
				Math.floor((seconds - gap * Math.floor(n)) / timeRanges[i - 1].value) > 0
			) {
				return (
					Math.floor(n) +
					timeRanges[i].name[0] +
					" " +
					Math.floor((seconds - gap * Math.floor(n)) / timeRanges[i - 1].value) +
					timeRanges[i - 1].name[0]
				);
			}
			return pluralize(Math.floor(n), timeRanges[i].name);
		}
	}

	return "<o<";
}

export function dateFromObjectId(objectId: string): Date {
	return new Date(parseInt(objectId.substring(0, 8), 16) * 1000);
}

/**
 * Compact duration for dense UI (game rows): 30m, 2h, 3d. Uses the largest whole unit.
 */
export function compactDuration(seconds: number): string {
	if (seconds < 3600) return `${Math.max(1, Math.round(seconds / 60))}m`;
	if (seconds < 86400) return `${Math.round(seconds / 3600)}h`;
	return `${Math.round(seconds / 86400)}d`;
}

/**
 * Whether the game's daily clock window is a real restriction (the clock pauses
 * overnight) versus running around the clock. timer.start/end are UTC
 * seconds-since-midnight; "always" is stored two ways — start === end (the app's
 * sentinel) or the API's near-full-day default { start: 0, end: 86399 } — so a
 * window only counts as restricted when its active span is meaningfully under 24h.
 */
export function isRestrictedTimerWindow(timer?: { start: number; end: number }): boolean {
	if (!timer || timer.start === timer.end) {
		return false;
	}
	// Active span of the [start, end) window each day. Wrap-around windows
	// (start > end, e.g. 22h–2h) run from start to midnight plus midnight to end.
	const span = timer.start < timer.end ? timer.end - timer.start : 24 * 3600 - timer.start + timer.end;
	// Under 24h by more than a minute → a genuine overnight pause.
	return span < 24 * 3600 - 60;
}

/**
 * Daily timer window for a game, e.g. "19h–08h" or "24h".
 */
export function timerWindow(timer?: { start: number; end: number }): string {
	return isRestrictedTimerWindow(timer) ? `${timerTime(timer?.start ?? 0)}–${timerTime(timer?.end ?? 0)}` : "24h";
}

/** timerWindow in an explicit timezone — see timerTimeInTz. */
export function timerWindowInTz(timer: { start: number; end: number } | undefined, tz: string): string {
	return isRestrictedTimerWindow(timer)
		? `${timerTimeInTz(timer?.start ?? 0, tz)}–${timerTimeInTz(timer?.end ?? 0, tz)}`
		: "24h";
}

/**
 * A game is "live" (real-time) when each player's whole-game clock fits in a
 * sitting — under a day — so it's meant to be played in one go. Longer clocks
 * (a day or more per player) are "asynchronous": players move over days.
 * Matches the new-game timing presets, which jump from 6h straight to 24h.
 */
export const LIVE_GAME_MAX_TIME_PER_GAME = 24 * 3600;
export type GamePace = "live" | "async";

export function gamePace(timePerGame: number | undefined): GamePace {
	return (timePerGame ?? 0) < LIVE_GAME_MAX_TIME_PER_GAME ? "live" : "async";
}

export function dateTime(date: Date): string {
	return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(
		2,
		"0",
	)} ${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}
