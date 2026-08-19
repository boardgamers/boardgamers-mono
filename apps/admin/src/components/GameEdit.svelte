<script lang="ts">
	import type { GameInfoFront } from "@bgs/models";
	import MarkdownEditor from "./MarkdownEditor.svelte";
	import { toast } from "$lib/toast.svelte.ts";
	import { trim } from "$lib/actions.ts";
	import { fetchLatestVersion, parseNpmUrl, setNpmVersion } from "$lib/npm.ts";

	export type GameInfoData = Partial<Pick<GameInfoFront, "_id">> & Omit<GameInfoFront, "_id">;

	// Raw-file POST (bundle uploads, #268): the JSON api helper would stringify
	// the File; the endpoint wants the raw bytes (same pattern as the avatar
	// upload on the web app).
	async function uploadRaw(path: string, file: File): Promise<{ url: string }> {
		const res = await fetch(path, {
			method: "POST",
			credentials: "same-origin",
			headers: { "Content-Type": "application/octet-stream" },
			body: file,
		});
		const text = await res.text();
		let data: unknown = {};
		try {
			data = JSON.parse(text);
		} catch {
			// Non-JSON error page (e.g. a proxy 502) — fall through to the generic message.
		}
		if (!res.ok) {
			const message =
				typeof data === "object" && data && "message" in data && typeof data.message === "string"
					? data.message
					: `Upload failed (${res.status}${res.statusText ? ` ${res.statusText}` : ""})`;
			throw new Error(message);
		}
		return data as { url: string };
	}

	type OptionItem = {
		name: string;
		label: string;
		type: string;
		default?: unknown;
		items?: { name: string; label: string }[] | null;
		category?: string;
		faction?: string;
	};
	type ViewerData = NonNullable<GameInfoData["viewer"]>;

	interface Props {
		mode: "new" | "edit";
		value: GameInfoData;
		onsave: (data: GameInfoData) => void;
		ondelete?: () => void;
		onduplicate?: () => void;
		// Game-level metadata (label/alias/description/rules/credits/links/players/
		// needOwnership) is centrally-managed game metadata (#298). When true, those
		// fields render read-only and are stripped from the save payload so a
		// version-page save never mutates shared metadata.
		metadataReadOnly?: boolean;
		// Which group(s) to render. "all" (default) shows the Game group then the
		// Version group (used by the new-game form). "game" shows only the game-level
		// metadata section; "version" shows only the version-level config — the game
		// page renders the two as separate sections (metadata on top, version config in
		// a per-version tab).
		sections?: "all" | "game" | "version";
	}

	let {
		mode,
		value = $bindable(),
		onsave,
		ondelete,
		onduplicate,
		metadataReadOnly = false,
		sections = "all",
	}: Props = $props();

	const inputClass =
		"w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-700 bg-transparent text-sm focus:outline-none focus:ring-2 focus:ring-blue-500";
	const labelClass = "block text-xs font-medium mb-1 text-gray-500 dark:text-gray-400";
	const btnSmClass = "px-2 py-1 text-xs rounded-md font-medium";

	// Per-section ("Viewer" / "Alternate Viewer" / "engine") npm version check state.
	const upgrade: Record<string, { checking?: boolean; pkg?: string; latest?: string } | undefined> = $state({});

	async function checkViewerVersion(key: string, viewer: ViewerData) {
		const parsed = parseNpmUrl(viewer.url);
		if (!parsed) {
			toast.error("No npm package detected in the viewer URL (expected …/npm/<package>@<version>/…)");
			return;
		}
		upgrade[key] = { checking: true };
		try {
			const latest = await fetchLatestVersion(parsed.pkg);
			if (latest === parsed.version) {
				toast.success(`${parsed.pkg} is already at the latest version (${latest})`);
				upgrade[key] = undefined;
			} else {
				upgrade[key] = { pkg: parsed.pkg, latest };
			}
		} catch (err) {
			upgrade[key] = undefined;
			toast.error(err instanceof Error ? err.message : "Failed to fetch latest version");
		}
	}

	function applyViewerUpgrade(key: string, viewer: ViewerData) {
		const info = upgrade[key];
		if (!info?.pkg || !info.latest) return;
		viewer.url = setNpmVersion(viewer.url, info.pkg, info.latest);
		if (viewer.dependencies) {
			viewer.dependencies.scripts = viewer.dependencies.scripts.map((s) => setNpmVersion(s, info.pkg!, info.latest!));
			viewer.dependencies.stylesheets = viewer.dependencies.stylesheets.map((s) =>
				setNpmVersion(s, info.pkg!, info.latest!)
			);
		}
		upgrade[key] = undefined;
		toast.success(`Updated ${info.pkg} to ${info.latest} — don't forget to save`);
	}

	async function checkEngineVersion() {
		const pkg = value.engine?.package.name;
		if (!pkg) {
			toast.error("Set the engine package name first");
			return;
		}
		upgrade["engine"] = { checking: true };
		try {
			const latest = await fetchLatestVersion(pkg);
			if (latest === value.engine!.package.version) {
				toast.success(`${pkg} is already at the latest version (${latest})`);
				upgrade["engine"] = undefined;
			} else {
				upgrade["engine"] = { pkg, latest };
			}
		} catch (err) {
			upgrade["engine"] = undefined;
			toast.error(err instanceof Error ? err.message : "Failed to fetch latest version");
		}
	}

	function applyEngineUpgrade() {
		const info = upgrade["engine"];
		if (!info?.latest) return;
		value.engine = { ...value.engine!, package: { ...value.engine!.package, version: info.latest } };
		upgrade["engine"] = undefined;
		toast.success(`Updated ${info.pkg} to ${info.latest} — don't forget to save`);
	}

	// --- Bundle uploads (#268) ---
	// Viewer uploads only fill in the form (Save persists); engine uploads save
	// immediately — the endpoint reads name/version out of the tarball and must
	// not fight unsaved form state.
	let uploadingViewer: Record<string, boolean> = $state({});
	let uploadingEngine = $state(false);

	// The first picked .js is the entry point (→ viewer.url); every other .js is
	// a dependency script, every .css a dependency stylesheet, every .map a
	// devtools sourcemap. All files in one pick share a `bundle` id so a relative
	// `//# sourceMappingURL=foo.js.map` in the .js resolves to the picked .map.
	// Pre-existing dependency URLs are kept (uploaded ones appended) — viewer.url
	// itself is replaced, since that's the file being swapped for the self-hosted bundle.
	async function uploadViewerFiles(key: string, viewer: ViewerData, alternate: boolean, files: File[]) {
		if (!value._id?.game || !value._id?.version) {
			toast.error("Save the game first, then upload a viewer bundle");
			return;
		}
		const jsFiles = files.filter((f) => f.name.endsWith(".js"));
		const mapFiles = files.filter((f) => f.name.endsWith(".map"));
		if (jsFiles.length === 0 && mapFiles.length === 0) {
			toast.error("Pick at least a bundled viewer .js file (plus optional extra .js/.css/.map)");
			return;
		}
		uploadingViewer[key] = true;
		try {
			const base = `/api/admin/gameinfo/${value._id.game}/${value._id.version}/viewer/file`;
			const suffix = alternate ? "&alternate=1" : "";
			// One shared bundle id per upload batch so a picked .js and its .map land
			// in the same S3 directory and a relative sourceMappingURL resolves.
			const bundle = `&bundle=${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
			const urls = await Promise.all(
				files.map(async (f) => ({
					file: f,
					url: (await uploadRaw(`${base}?filename=${encodeURIComponent(f.name)}${suffix}${bundle}`, f)).url,
				}))
			);
			// No .js in this pick: the .map belongs to the already-configured
			// viewer.url — leave URL/dependencies untouched.
			if (jsFiles.length > 0) {
				viewer.url = urls.find((u) => u.file === jsFiles[0])!.url;
				const cssFiles = files.filter((f) => f.name.endsWith(".css"));
				const depScripts = urls.filter((u) => jsFiles.includes(u.file) && u.file !== jsFiles[0]).map((u) => u.url);
				const depStyles = urls.filter((u) => cssFiles.includes(u.file)).map((u) => u.url);
				viewer.dependencies = {
					scripts: [...(viewer.dependencies?.scripts ?? []), ...depScripts],
					stylesheets: [...(viewer.dependencies?.stylesheets ?? []), ...depStyles],
				};
			}
			toast.success(`Uploaded ${files.map((f) => f.name).join(" + ")} — don't forget to save`);
		} catch (err) {
			toast.error(err instanceof Error ? err.message : "Upload failed");
		} finally {
			uploadingViewer[key] = false;
		}
	}

	async function uploadEngine(file: File) {
		if (!value._id?.game || !value._id?.version) {
			toast.error("Save the game first, then upload an engine tarball");
			return;
		}
		uploadingEngine = true;
		try {
			const doc = await uploadRaw(`/api/admin/gameinfo/${value._id.game}/${value._id.version}/engine`, file);
			const saved = doc as unknown as GameInfoData;
			if (saved.engine?.package) {
				value.engine = { ...value.engine!, package: { ...saved.engine.package } };
			}
			toast.success(`Uploaded ${file.name} — engine now installs from the hosted tarball`);
		} catch (err) {
			toast.error(err instanceof Error ? err.message : "Upload failed");
		} finally {
			uploadingEngine = false;
		}
	}

	// Swap default ↔ alternate viewer (#268) and persist immediately through the
	// normal save flow (the admin gameinfo upsert route). Only offered in edit
	// mode with an alternate set.
	function swapViewers() {
		const alternate = value.viewer.alternate;
		if (!alternate) return;
		const { alternate: _dropped, ...primary } = value.viewer;
		value.viewer = { ...alternate, alternate: primary };
		handleSave();
	}

	function ensureViewer() {
		value.viewer ??= { url: "" } as ViewerData;
		value.viewer.dependencies ??= { scripts: [], stylesheets: [] };
		value.viewer.dependencies.scripts ??= [];
		value.viewer.dependencies.stylesheets ??= [];
	}

	function ensureAlternateViewer() {
		ensureViewer();
		value.viewer.alternate ??= {
			url: "",
			topLevelVariable: "",
			dependencies: { scripts: [], stylesheets: [] },
			fullScreen: false,
			replayable: false,
			trusted: false,
		};
		value.viewer.alternate.dependencies ??= { scripts: [], stylesheets: [] };
		value.viewer.alternate.dependencies.scripts ??= [];
		value.viewer.alternate.dependencies.stylesheets ??= [];
	}

	function addPlayer() {
		value.players = [...value.players, value.players.length > 0 ? Math.max(...value.players) + 1 : 2];
	}

	function removePlayer(idx: number) {
		value.players = value.players.filter((_, i) => i !== idx);
	}

	function addDep(viewer: ViewerData, type: "scripts" | "stylesheets") {
		viewer.dependencies ??= { scripts: [], stylesheets: [] };
		viewer.dependencies[type] ??= [];
		viewer.dependencies[type] = [...viewer.dependencies[type], ""];
	}

	function removeDep(viewer: ViewerData, type: "scripts" | "stylesheets", idx: number) {
		viewer.dependencies![type] = viewer.dependencies![type].filter((_, i) => i !== idx);
	}

	function getList(variable: "expansions" | "options" | "preferences" | "settings"): OptionItem[] {
		return (value[variable] ?? []) as OptionItem[];
	}

	function setList(variable: "expansions" | "options" | "preferences" | "settings", arr: OptionItem[]) {
		(value as Record<string, unknown>)[variable] = arr;
	}

	function addListItem(variable: "expansions" | "options" | "preferences" | "settings") {
		const arr = getList(variable);
		arr.push({ name: "", label: "", type: "checkbox", items: null });
		setList(variable, [...arr]);
	}

	function removeListItem(variable: "expansions" | "options" | "preferences" | "settings", idx: number) {
		const arr = getList(variable);
		arr.splice(idx, 1);
		setList(variable, [...arr]);
	}

	function moveItem(variable: "expansions" | "options" | "preferences" | "settings", idx: number, dir: -1 | 1) {
		const arr = getList(variable);
		const target = idx + dir;
		if (target < 0 || target >= arr.length) return;
		[arr[idx], arr[target]] = [arr[target], arr[idx]];
		setList(variable, [...arr]);
	}

	// --- Drag & drop reordering ---
	// `key` identifies a list: a section key ("options", …) or "<section>#<index>" for a select's sub-items.
	let drag: { key: string; from: number } | null = $state(null);
	let dragOver: { key: string; to: number } | null = $state(null);

	function reorder<T>(arr: T[], from: number, to: number): T[] {
		const copy = [...arr];
		const [moved] = copy.splice(from, 1);
		copy.splice(to, 0, moved);
		return copy;
	}

	function handleDragStart(e: DragEvent, key: string, from: number) {
		drag = { key, from };
		if (e.dataTransfer) {
			e.dataTransfer.effectAllowed = "move";
			// Drag the whole card/row visually, not just the handle.
			const card = (e.target as HTMLElement).closest("[data-draggable-card]");
			if (card) e.dataTransfer.setDragImage(card, 16, 16);
		}
	}

	function handleDragOver(e: DragEvent, key: string, to: number) {
		if (drag?.key !== key) return;
		e.preventDefault();
		if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
		dragOver = { key, to };
	}

	function handleDrop(key: string, to: number, apply: (from: number, to: number) => void) {
		if (drag?.key === key && drag.from !== to) apply(drag.from, to);
		drag = null;
		dragOver = null;
	}

	function handleDragEnd() {
		drag = null;
		dragOver = null;
	}

	function isDropTarget(key: string, index: number): boolean {
		return drag !== null && dragOver?.key === key && dragOver.to === index && drag.from !== index;
	}

	function addSelectItem(option: OptionItem) {
		option.items = [...(option.items ?? []), { name: "", label: "" }];
	}

	function removeSelectItem(option: OptionItem, idx: number) {
		option.items = (option.items ?? []).filter((_, i) => i !== idx);
	}

	// Game-level metadata fields (hoisted to `gameMetadatas` in #298); when
	// `metadataReadOnly` the version page renders them read-only and never saves them.
	// `expansions` is version-scoped (a setup option that can differ per version), so
	// it is NOT stripped here.
	const METADATA_FIELDS = [
		"label",
		"alias",
		"description",
		"rules",
		"credits",
		"links",
		"players",
		"needOwnership",
	] as const;

	function handleSave() {
		for (const setting of value.settings ?? []) {
			if (!(setting as OptionItem).faction) {
				delete (setting as OptionItem).faction;
			}
		}
		if (metadataReadOnly) {
			const payload: GameInfoData = { ...value };
			for (const field of METADATA_FIELDS) {
				delete payload[field];
			}
			onsave(payload);
			return;
		}
		// Drop empty links; rebuild the object so tsgo is happy deleting optional keys.
		if (value.links) {
			const links = Object.fromEntries(Object.entries(value.links).filter(([, url]) => url));
			value.links = Object.keys(links).length > 0 ? links : undefined;
		}
		// An empty alias input clears the alias; it must reach the API as null (not a
		// dropped undefined) so the upsert's $unset removes it from the doc.
		value.alias = value.alias?.trim() || null;
		onsave(value);
	}

	$effect.pre(() => {
		ensureViewer();
		value.factions ??= { avatars: false };
		value.expansions ??= [];
		value.options ??= [];
		value.preferences ??= [];
		value.settings ??= [];
	});
</script>

<div class="space-y-6">
	{#if sections !== "version"}
		<!-- ===== Game-level metadata (shared by all versions; #298) ===== -->
		<h3
			class="text-sm font-semibold uppercase tracking-wider text-gray-400 border-b border-gray-200 dark:border-gray-800 pb-1"
		>
			Game
		</h3>

		<!-- Basic Info -->
		<div class="grid grid-cols-1 md:grid-cols-2 gap-4">
			<div>
				<label for="game-label" class={labelClass}>Label</label>
				<input id="game-label" bind:value={value.label} class={inputClass} disabled={metadataReadOnly} />
			</div>
			<div>
				<label for="game-alias" class={labelClass}>Alias</label>
				<input
					id="game-alias"
					bind:value={value.alias}
					class={inputClass}
					placeholder="Public display name (e.g. Gem Trader) — leave empty for none"
					disabled={metadataReadOnly}
				/>
				<p class="mt-1 text-xs text-gray-400 dark:text-gray-500">
					Shown everywhere instead of the label; the label is noted as the rules source ("&lt;Label&gt; rules").
				</p>
			</div>
			{#if mode === "new"}
				<div class="grid grid-cols-2 gap-4">
					<div>
						<label for="game-id" class={labelClass}>Game ID</label>
						<input
							id="game-id"
							value={value._id?.game ?? ""}
							use:trim
							oninput={(e) => {
								value._id = { game: e.currentTarget.value, version: value._id?.version ?? 1 };
							}}
							class={inputClass}
						/>
					</div>
					<div>
						<label for="game-version" class={labelClass}>Version</label>
						<input
							id="game-version"
							type="number"
							value={value._id?.version ?? 1}
							oninput={(e) => {
								value._id = { game: value._id?.game ?? "", version: Number(e.currentTarget.value) };
							}}
							class={inputClass}
						/>
					</div>
				</div>
			{:else if sections !== "game"}
				<!-- Version-independent metadata: the "game vN" line is only meaningful when
			     the version group is also shown (or on a version page). -->
				<div class="flex items-end gap-2 text-sm text-gray-500 pb-2">
					{value._id?.game} v{value._id?.version}
				</div>
			{/if}
		</div>

		<!-- Players -->
		<div>
			<label for="player-0" class={labelClass}>Players</label>
			<div class="flex flex-wrap gap-2 items-center">
				{#each value.players as _, i (i)}
					<div class="flex items-center gap-1 bg-gray-100 dark:bg-gray-800 rounded-lg px-3 py-1.5 text-sm">
						<input
							id={"player-" + i}
							type="number"
							bind:value={value.players[i]}
							class="w-12 bg-transparent text-center focus:outline-none"
							disabled={metadataReadOnly}
						/>
						{#if !metadataReadOnly}
							<button onclick={() => removePlayer(i)} class="text-red-500 hover:text-red-400 ml-1">&times;</button>
						{/if}
					</div>
				{/each}
				{#if !metadataReadOnly}
					<button onclick={addPlayer} class="px-3 py-1.5 text-sm text-blue-600 hover:text-blue-500 font-medium"
						>+ Add</button
					>
				{/if}
			</div>
		</div>

		<!-- Requires ownership (game-level: a property of the game, not the version) -->
		<label class="flex items-center gap-2 text-sm">
			<input type="checkbox" bind:checked={value.needOwnership} class="rounded" disabled={metadataReadOnly} /> Requires ownership
		</label>

		<!-- Links -->
		<details open class="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800">
			<summary class="px-5 py-3 cursor-pointer text-sm font-semibold">Links</summary>
			<div class="px-5 pb-4 grid grid-cols-1 md:grid-cols-2 gap-3">
				{#each [{ key: "source" as const, label: "Source code URL", placeholder: "https://github.com/…" }, { key: "bgg" as const, label: "BoardGameGeek URL", placeholder: "https://boardgamegeek.com/boardgame/…" }, { key: "publisher" as const, label: "Publisher URL", placeholder: "https://…" }, { key: "buy" as const, label: "Buy URL (affiliate)", placeholder: "https://…" }] as field (field.key)}
					<div>
						<label for={"link-" + field.key} class={labelClass}>{field.label}</label>
						<input
							id={"link-" + field.key}
							value={value.links?.[field.key] ?? ""}
							use:trim
							oninput={(e) => {
								value.links = { ...value.links, [field.key]: e.currentTarget.value };
							}}
							placeholder={field.placeholder}
							class={inputClass}
							disabled={metadataReadOnly}
						/>
					</div>
				{/each}
			</div>
		</details>

		<!-- Description & Rules: each is full-width and mostly empty, so on large
		     screens they sit side-by-side to reclaim the wasted vertical space. -->
		{#if metadataReadOnly}
			<div class="grid grid-cols-1 lg:grid-cols-2 gap-4">
				{#if value.description}
					<div class="space-y-1">
						<span class="block text-sm font-medium">Description</span>
						<p class="text-sm text-gray-500 dark:text-gray-400 whitespace-pre-wrap">{value.description}</p>
					</div>
				{/if}
				{#if value.rules}
					<div class="space-y-1">
						<span class="block text-sm font-medium">Rules</span>
						<p class="text-sm text-gray-500 dark:text-gray-400 whitespace-pre-wrap">{value.rules}</p>
					</div>
				{/if}
				{#if value.credits}
					<div class="space-y-1">
						<span class="block text-sm font-medium">Credits</span>
						<p class="text-sm text-gray-500 dark:text-gray-400 whitespace-pre-wrap">{value.credits}</p>
					</div>
				{/if}
			</div>
		{:else}
			<div class="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
				<MarkdownEditor bind:value={value.description} label="Description (Markdown)" rows={6} />
				<MarkdownEditor bind:value={value.rules} label="Rules (Markdown)" rows={10} />
				<MarkdownEditor bind:value={value.credits} label="Credits (Markdown)" rows={6} />
			</div>
		{/if}
	{/if}

	{#if sections !== "game"}
		<!-- ===== Version-level config (this engine/viewer version only) ===== -->
		<h3
			class="text-sm font-semibold uppercase tracking-wider text-gray-400 border-b border-gray-200 dark:border-gray-800 pb-1 pt-2"
		>
			Version
		</h3>

		<!-- Version-level flags. Public is version-scoped (a game can have a public v1 +
	     a beta v2): only public versions are listed and open to everyone — non-public
	     versions stay reachable for users with an access grant. -->
		<div class="flex flex-wrap items-center gap-x-6 gap-y-2">
			<label class="flex items-center gap-2 text-sm font-medium">
				<input type="checkbox" bind:checked={value.public} class="rounded" /> Public
				<span class="font-normal text-gray-400">— listed & open to everyone (per version)</span>
			</label>
			<label class="flex items-center gap-2 text-sm">
				<input type="checkbox" bind:checked={value.factions!.avatars} class="rounded" /> Faction avatars
			</label>
		</div>

		<!-- Viewer (primary) -->
		{#snippet viewerFields(viewer: ViewerData, title: string)}
			<details open class="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800">
				<summary class="px-5 py-3 cursor-pointer text-sm font-semibold">{title}</summary>
				<div class="px-5 pb-4 space-y-3">
					<div>
						<div class="flex items-center justify-between mb-1">
							<label for={title === "Viewer" ? "viewer-url" : "alt-viewer-url"} class="{labelClass} mb-0">URL</label>
							{#if upgrade[title]?.latest}
								<button
									onclick={() => applyViewerUpgrade(title, viewer)}
									class="cursor-pointer text-xs font-medium text-white bg-emerald-600 hover:bg-emerald-700 px-2 py-0.5 rounded"
								>
									Update to {upgrade[title]?.latest}
								</button>
							{:else}
								<button
									onclick={() => checkViewerVersion(title, viewer)}
									disabled={upgrade[title]?.checking}
									class="cursor-pointer text-xs font-medium text-blue-600 hover:text-blue-500 px-2 py-0.5 rounded border border-blue-200 dark:border-blue-900 hover:bg-blue-50 dark:hover:bg-blue-950 disabled:opacity-50"
								>
									{upgrade[title]?.checking ? "Checking…" : "Check latest"}
								</button>
							{/if}
						</div>
						<input
							id={title === "Viewer" ? "viewer-url" : "alt-viewer-url"}
							bind:value={viewer.url}
							class={inputClass}
						/>
						<!-- Self-hosted bundle (#268): pick a pre-built viewer JS (+ optional
					     CSS); uploads fill in URL/dependencies — Save persists them. -->
						<div class="flex flex-wrap items-center gap-2 mt-1.5">
							<label
								class="{btnSmClass} cursor-pointer text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-900 hover:bg-emerald-50 dark:hover:bg-emerald-950 {uploadingViewer[
									title
								]
									? 'opacity-50 pointer-events-none'
									: ''}"
							>
								{uploadingViewer[title] ? "Uploading…" : "Upload bundle…"}
								<input
									type="file"
									accept=".js,.css,.map"
									multiple
									class="hidden"
									disabled={uploadingViewer[title]}
									onchange={(e) => {
										const files = [...(e.currentTarget.files ?? [])];
										e.currentTarget.value = "";
										uploadViewerFiles(title, viewer, title !== "Viewer", files);
									}}
								/>
							</label>
							<span class="text-xs text-gray-400"
								>Pre-built bundle: first .js becomes the viewer URL, extra .js/.css become dependencies — hosted on S3.
								An optional .map is just hosted for devtools. Each file lands in its own content-hashed
								directory, so a relative `sourceMappingURL` won't resolve — either point it at the map's
								absolute hosted URL, or upload via the API with a shared `?bundle=` id so the .js and .map
								share a directory.</span
							>
						</div>
					</div>
					<div>
						<label for={title === "Viewer" ? "viewer-toplevel" : "alt-viewer-toplevel"} class={labelClass}
							>Top-level variable</label
						>
						<input
							id={title === "Viewer" ? "viewer-toplevel" : "alt-viewer-toplevel"}
							bind:value={viewer.topLevelVariable}
							class={inputClass}
						/>
					</div>

					<!-- Dependencies -->
					{#each ["scripts", "stylesheets"] as depType (depType)}
						<div>
							<label for={(title === "Viewer" ? "viewer" : "alt-viewer") + "-" + depType + "-0"} class={labelClass}
								>{depType[0].toUpperCase()}{depType.slice(1)}</label
							>
							{#each viewer.dependencies?.[depType as "scripts" | "stylesheets"] ?? [] as _, di (di)}
								<div class="flex gap-2 mb-1">
									<input
										id={(title === "Viewer" ? "viewer" : "alt-viewer") + "-" + depType + "-" + di}
										bind:value={viewer.dependencies![depType as "scripts" | "stylesheets"][di]}
										class="{inputClass} flex-1"
										placeholder="{depType.slice(0, -1)} URL"
									/>
									<button
										onclick={() => removeDep(viewer, depType as "scripts" | "stylesheets", di)}
										class="{btnSmClass} text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20">&times;</button
									>
								</div>
							{/each}
							<button
								onclick={() => addDep(viewer, depType as "scripts" | "stylesheets")}
								class="{btnSmClass} text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/20 mt-1"
							>
								+ Add {depType.slice(0, -1)}
							</button>
						</div>
					{/each}

					<div class="flex gap-4 pt-1">
						<label class="flex items-center gap-2 text-sm">
							<input type="checkbox" bind:checked={viewer.replayable} class="rounded" /> Replayable
						</label>
						<label class="flex items-center gap-2 text-sm">
							<input type="checkbox" bind:checked={viewer.fullScreen} class="rounded" /> Full screen
						</label>
						<label class="flex items-center gap-2 text-sm">
							<input type="checkbox" bind:checked={viewer.trusted} class="rounded" /> Trusted
						</label>
					</div>
				</div>
			</details>
		{/snippet}

		{@render viewerFields(value.viewer, "Viewer")}

		<!-- Alternate Viewer -->
		<div>
			{#if value.viewer.alternate}
				{@render viewerFields(value.viewer.alternate, "Alternate Viewer")}
				<div class="flex gap-2 mt-2">
					<button
						onclick={() => {
							value.viewer.alternate = undefined;
						}}
						class="{btnSmClass} text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20">Remove alternate viewer</button
					>
					{#if mode === "edit"}
						<button
							onclick={swapViewers}
							title="Swap the default and alternate viewers, then save"
							class="{btnSmClass} text-amber-700 dark:text-amber-400 border border-amber-200 dark:border-amber-900 hover:bg-amber-50 dark:hover:bg-amber-950"
							>⇄ Make alternate the default viewer</button
						>
					{/if}
				</div>
			{:else}
				<button
					onclick={() => {
						ensureAlternateViewer();
						value.viewer = { ...value.viewer };
					}}
					class="{btnSmClass} text-blue-600">+ Add alternate viewer</button
				>
			{/if}
		</div>

		<!-- Engine -->
		<details open class="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800">
			<summary class="px-5 py-3 cursor-pointer text-sm font-semibold">Engine</summary>
			<div class="px-5 pb-4">
				<!-- Self-hosted engine (#268): upload a pre-built `npm pack` tarball; the
			     endpoint stores it on S3 and points engine.package at the hosted URL
			     (saves immediately). -->
				<div class="flex flex-wrap items-center gap-2 mb-3">
					<label
						class="{btnSmClass} cursor-pointer text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-900 hover:bg-emerald-50 dark:hover:bg-emerald-950 {uploadingEngine
							? 'opacity-50 pointer-events-none'
							: ''}"
					>
						{uploadingEngine ? "Uploading…" : "Upload .tgz…"}
						<input
							type="file"
							accept=".tgz"
							class="hidden"
							disabled={uploadingEngine}
							onchange={(e) => {
								const file = e.currentTarget.files?.[0];
								e.currentTarget.value = "";
								if (file) uploadEngine(file);
							}}
						/>
					</label>
					<span class="text-xs text-gray-400"
						>Pre-built <code>npm pack</code> tarball (dist included) — saves immediately</span
					>
					{#if value.engine?.package.url}
						<span class="text-xs text-emerald-600 dark:text-emerald-400 break-all"
							>hosted: {value.engine.package.url}</span
						>
					{/if}
				</div>
				<div class="grid grid-cols-1 md:grid-cols-3 gap-3">
					<div>
						<label for="engine-package-name" class={labelClass}>Package name</label>
						<input
							id="engine-package-name"
							value={value.engine?.package.name ?? ""}
							use:trim
							oninput={(e) => {
								value.engine = { ...value.engine!, package: { ...value.engine!.package, name: e.currentTarget.value } };
							}}
							class={inputClass}
						/>
					</div>
					<div>
						<div class="flex items-center justify-between mb-1">
							<label for="engine-package-version" class="{labelClass} mb-0">Package version</label>
							{#if upgrade["engine"]?.latest}
								<button
									onclick={applyEngineUpgrade}
									class="cursor-pointer text-xs font-medium text-white bg-emerald-600 hover:bg-emerald-700 px-2 py-0.5 rounded"
								>
									Update to {upgrade["engine"]?.latest}
								</button>
							{:else}
								<button
									onclick={checkEngineVersion}
									disabled={upgrade["engine"]?.checking}
									class="cursor-pointer text-xs font-medium text-blue-600 hover:text-blue-500 px-2 py-0.5 rounded border border-blue-200 dark:border-blue-900 hover:bg-blue-50 dark:hover:bg-blue-950 disabled:opacity-50"
								>
									{upgrade["engine"]?.checking ? "Checking…" : "Check latest"}
								</button>
							{/if}
						</div>
						<input
							id="engine-package-version"
							value={value.engine?.package.version ?? ""}
							use:trim
							oninput={(e) => {
								value.engine = {
									...value.engine!,
									package: { ...value.engine!.package, version: e.currentTarget.value },
								};
							}}
							class={inputClass}
						/>
					</div>
					<div>
						<label for="engine-entry-point" class={labelClass}>Entry point</label>
						<input
							id="engine-entry-point"
							value={value.engine?.entryPoint ?? ""}
							use:trim
							oninput={(e) => {
								value.engine = { ...value.engine!, entryPoint: e.currentTarget.value };
							}}
							class={inputClass}
						/>
					</div>
				</div>
			</div>
		</details>

		<!-- Options/Preferences/Settings/Expansions share one card renderer. All four are
	     version-level setup sections (expansions is a setup option that can differ per
	     version), so they stay editable on version pages. -->
		{#snippet sectionCard(section: {
			key: "expansions" | "options" | "preferences" | "settings";
			label: string;
			showType: boolean;
			showFaction: boolean;
			showCategory: boolean;
		})}
			<details open class="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800">
				<summary class="px-5 py-3 cursor-pointer text-sm font-semibold">{section.label}</summary>
				<div class="px-5 pb-4 space-y-3">
					{#each value[section.key] ?? [] as item, i (i)}
						{@const items = value[section.key] as OptionItem[]}
						<div
							data-draggable-card
							role="listitem"
							class="border rounded-lg p-3 space-y-2 transition-colors {isDropTarget(section.key, i)
								? 'border-blue-400 dark:border-blue-500 bg-blue-50/50 dark:bg-blue-950/30'
								: 'border-gray-100 dark:border-gray-800'}"
							ondragover={(e) => handleDragOver(e, section.key, i)}
							ondrop={(e) => {
								e.preventDefault();
								handleDrop(section.key, i, (from, to) => setList(section.key, reorder(getList(section.key), from, to)));
							}}
						>
							<div class="flex gap-2 items-start">
								<div class="flex-1 grid grid-cols-1 sm:grid-cols-2 gap-2">
									<div>
										<label for={section.key + "-" + i + "-id"} class={labelClass}>{section.label.slice(0, -1)} ID</label
										>
										<input
											id={section.key + "-" + i + "-id"}
											bind:value={(item as OptionItem).name}
											class={inputClass}
										/>
									</div>
									<div>
										<label for={section.key + "-" + i + "-name"} class={labelClass}
											>{section.label.slice(0, -1)} name</label
										>
										<input
											id={section.key + "-" + i + "-name"}
											bind:value={(item as OptionItem).label}
											class={inputClass}
										/>
									</div>

									{#if section.showType}
										<div>
											<label for={section.key + "-" + i + "-type"} class={labelClass}>Type</label>
											<select
												id={section.key + "-" + i + "-type"}
												bind:value={(item as OptionItem).type}
												class={inputClass}
											>
												<option value="checkbox">checkbox</option>
												<option value="select">select</option>
												<option value="hidden">hidden</option>
												<option value="category">category</option>
											</select>
										</div>
									{/if}

									{#if section.showType && (item as OptionItem).type === "checkbox" && section.key !== "settings"}
										<div>
											<label class="flex items-center gap-2 text-sm mt-2">
												<input type="checkbox" bind:checked={(item as OptionItem).default as boolean} class="rounded" /> Default
												value
											</label>
										</div>
									{/if}

									{#if section.showType && (item as OptionItem).type === "select" && section.key !== "settings"}
										<div>
											<label for={section.key + "-" + i + "-default"} class={labelClass}>Default</label>
											<select
												id={section.key + "-" + i + "-default"}
												bind:value={(item as OptionItem).default}
												class={inputClass}
											>
												{#each (item as OptionItem).items ?? [] as opt (opt.name)}
													<option value={opt.name}>{opt.label}</option>
												{/each}
											</select>
										</div>
									{/if}

									{#if section.showCategory && (item as OptionItem).type !== "category"}
										<div>
											<label for={section.key + "-" + i + "-category"} class={labelClass}>Category</label>
											<select
												id={section.key + "-" + i + "-category"}
												bind:value={(item as OptionItem).category}
												class={inputClass}
											>
												<option value={undefined}>None</option>
												{#each items.filter((x) => x.type === "category") as cat (cat.name)}
													<option value={cat.name}>{cat.label}</option>
												{/each}
											</select>
										</div>
									{/if}

									{#if section.showFaction}
										<div>
											<label for={section.key + "-" + i + "-faction"} class={labelClass}>Faction</label>
											<input
												id={section.key + "-" + i + "-faction"}
												bind:value={(item as OptionItem).faction}
												class={inputClass}
											/>
										</div>
									{/if}
								</div>

								<!-- Reorder & Delete -->
								<div class="flex flex-col gap-1 pt-5 items-center">
									<span
										draggable="true"
										role="button"
										tabindex="-1"
										aria-label="Drag to reorder"
										title="Drag to reorder"
										class="cursor-grab active:cursor-grabbing text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 px-1 select-none leading-none"
										ondragstart={(e) => handleDragStart(e, section.key, i)}
										ondragend={handleDragEnd}>⠿</span
									>
									<button
										onclick={() => moveItem(section.key, i, -1)}
										disabled={i === 0}
										class="{btnSmClass} text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-25"
										title="Move up">&#9650;</button
									>
									<button
										onclick={() => moveItem(section.key, i, 1)}
										disabled={i === items.length - 1}
										class="{btnSmClass} text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-25"
										title="Move down">&#9660;</button
									>
									<button
										onclick={() => removeListItem(section.key, i)}
										class="{btnSmClass} text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20"
										title="Delete">&times;</button
									>
								</div>
							</div>

							<!-- Select items sub-list -->
							{#if section.showType && (item as OptionItem).type === "select"}
								{@const subKey = `${section.key}#${i}`}
								<div class="ml-4 mt-2 border-l-2 border-gray-200 dark:border-gray-700 pl-4 space-y-2">
									<span class="text-xs font-semibold text-gray-500">Items for {(item as OptionItem).name || "..."}</span
									>
									{#each (item as OptionItem).items ?? [] as subItem, j (j)}
										<div
											data-draggable-card
											role="listitem"
											class="flex gap-2 items-center rounded-lg transition-colors {isDropTarget(subKey, j)
												? 'ring-2 ring-blue-400 dark:ring-blue-500'
												: ''}"
											ondragover={(e) => handleDragOver(e, subKey, j)}
											ondrop={(e) => {
												e.preventDefault();
												handleDrop(subKey, j, (from, to) => {
													(item as OptionItem).items = reorder((item as OptionItem).items ?? [], from, to);
												});
											}}
										>
											<span
												draggable="true"
												role="button"
												tabindex="-1"
												aria-label="Drag to reorder"
												title="Drag to reorder"
												class="cursor-grab active:cursor-grabbing text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 select-none leading-none"
												ondragstart={(e) => handleDragStart(e, subKey, j)}
												ondragend={handleDragEnd}>⠿</span
											>
											<input bind:value={subItem.name} placeholder="ID" class="{inputClass} flex-1" />
											<input bind:value={subItem.label} placeholder="Label" class="{inputClass} flex-1" />
											<button
												onclick={() => removeSelectItem(item as OptionItem, j)}
												class="{btnSmClass} text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20">&times;</button
											>
										</div>
									{/each}
									<button
										onclick={() => addSelectItem(item as OptionItem)}
										class="{btnSmClass} text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/20"
									>
										+ Add item
									</button>
								</div>
							{/if}
						</div>
					{/each}

					<button
						onclick={() => addListItem(section.key)}
						class="{btnSmClass} text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/20"
					>
						+ Add {section.label.slice(0, -1).toLowerCase()}
					</button>
				</div>
			</details>
		{/snippet}

		<!-- Version-level setup sections. `expansions` is version-scoped (a setup option
	     that can be implemented in only some versions), so it is editable here even on
	     version pages — unlike the game-level metadata in the Game group above. -->
		{#each [{ key: "expansions" as const, label: "Expansions", showType: false, showFaction: false, showCategory: false }, { key: "options" as const, label: "Options", showType: true, showFaction: false, showCategory: false }, { key: "preferences" as const, label: "Preferences", showType: true, showFaction: false, showCategory: true }, { key: "settings" as const, label: "Settings", showType: true, showFaction: true, showCategory: false }] as section (section.key)}
			{@render sectionCard(section)}
		{/each}
	{/if}

	<!-- Actions -->
	<div class="flex gap-2 pt-2">
		<button onclick={handleSave} class="px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium">
			{mode === "new" ? "Create" : "Save"}
		</button>
		{#if mode === "edit" && onduplicate}
			<button onclick={onduplicate} class="px-5 py-2.5 bg-gray-600 hover:bg-gray-700 text-white rounded-lg font-medium">
				Duplicate to next version
			</button>
		{/if}
		{#if mode === "edit" && ondelete}
			<button
				onclick={ondelete}
				class="px-5 py-2.5 bg-red-600 hover:bg-red-700 text-white rounded-lg font-medium ml-auto"
			>
				Delete
			</button>
		{/if}
	</div>
</div>
