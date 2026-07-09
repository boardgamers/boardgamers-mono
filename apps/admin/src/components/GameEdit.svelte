<script lang="ts">
	import type { GameInfoFront } from "@bgs/models";
	import MarkdownEditor from "./MarkdownEditor.svelte";
	import { toast } from "$lib/toast.svelte.ts";
	import { fetchLatestVersion, parseNpmUrl, setNpmVersion } from "$lib/npm.ts";

	export type GameInfoData = Partial<Pick<GameInfoFront, "_id">> & Omit<GameInfoFront, "_id">;

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
	}

	let { mode, value = $bindable(), onsave, ondelete, onduplicate }: Props = $props();

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
				setNpmVersion(s, info.pkg!, info.latest!),
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

	function handleSave() {
		for (const setting of value.settings ?? []) {
			if (!(setting as OptionItem).faction) {
				delete (setting as OptionItem).faction;
			}
		}
		onsave(value);
	}

	$effect(() => {
		ensureViewer();
		value.factions ??= { avatars: false };
		value.expansions ??= [];
		value.options ??= [];
		value.preferences ??= [];
		value.settings ??= [];
	});
</script>

<div class="space-y-6">
	<!-- Basic Info -->
	<div class="grid grid-cols-1 md:grid-cols-2 gap-4">
		<div>
			<label class={labelClass}>Label</label>
			<input bind:value={value.label} class={inputClass} />
		</div>
		{#if mode === "new"}
			<div class="grid grid-cols-2 gap-4">
				<div>
					<label class={labelClass}>Game ID</label>
					<input
						value={value._id?.game ?? ""}
						oninput={(e) => {
							value._id = { game: e.currentTarget.value, version: value._id?.version ?? 1 };
						}}
						class={inputClass}
					/>
				</div>
				<div>
					<label class={labelClass}>Version</label>
					<input
						type="number"
						value={value._id?.version ?? 1}
						oninput={(e) => {
							value._id = { game: value._id?.game ?? "", version: Number(e.currentTarget.value) };
						}}
						class={inputClass}
					/>
				</div>
			</div>
		{:else}
			<div class="flex items-end gap-2 text-sm text-gray-500 pb-2">
				{value._id?.game} v{value._id?.version}
			</div>
		{/if}
	</div>

	<!-- Players -->
	<div>
		<label class={labelClass}>Players</label>
		<div class="flex flex-wrap gap-2 items-center">
			{#each value.players as _, i}
				<div class="flex items-center gap-1 bg-gray-100 dark:bg-gray-800 rounded-lg px-3 py-1.5 text-sm">
					<input
						type="number"
						bind:value={value.players[i]}
						class="w-12 bg-transparent text-center focus:outline-none"
					/>
					<button onclick={() => removePlayer(i)} class="text-red-500 hover:text-red-400 ml-1">&times;</button>
				</div>
			{/each}
			<button onclick={addPlayer} class="px-3 py-1.5 text-sm text-blue-600 hover:text-blue-500 font-medium"
				>+ Add</button
			>
		</div>
	</div>

	<!-- Faction Avatars -->
	<label class="flex items-center gap-2 text-sm">
		<input type="checkbox" bind:checked={value.factions!.avatars} class="rounded" /> Faction avatars
	</label>

	<!-- Viewer (primary) -->
	{#snippet viewerFields(viewer: ViewerData, title: string)}
		<details open class="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800">
			<summary class="px-5 py-3 cursor-pointer text-sm font-semibold">{title}</summary>
			<div class="px-5 pb-4 space-y-3">
				<div>
					<div class="flex items-center justify-between mb-1">
						<label class="{labelClass} mb-0">URL</label>
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
					<input bind:value={viewer.url} class={inputClass} />
				</div>
				<div>
					<label class={labelClass}>Top-level variable</label>
					<input bind:value={viewer.topLevelVariable} class={inputClass} />
				</div>

				<!-- Dependencies -->
				{#each ["scripts", "stylesheets"] as depType}
					<div>
						<label class={labelClass}>{depType[0].toUpperCase()}{depType.slice(1)}</label>
						{#each viewer.dependencies?.[depType as "scripts" | "stylesheets"] ?? [] as _, di}
							<div class="flex gap-2 mb-1">
								<input
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
			<button
				onclick={() => {
					value.viewer.alternate = undefined;
				}}
				class="{btnSmClass} text-red-600 mt-2">Remove alternate viewer</button
			>
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
		<div class="px-5 pb-4 grid grid-cols-1 md:grid-cols-3 gap-3">
			<div>
				<label class={labelClass}>Package name</label>
				<input
					value={value.engine?.package.name ?? ""}
					oninput={(e) => {
						value.engine = { ...value.engine!, package: { ...value.engine!.package, name: e.currentTarget.value } };
					}}
					class={inputClass}
				/>
			</div>
			<div>
				<div class="flex items-center justify-between mb-1">
					<label class="{labelClass} mb-0">Package version</label>
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
					value={value.engine?.package.version ?? ""}
					oninput={(e) => {
						value.engine = { ...value.engine!, package: { ...value.engine!.package, version: e.currentTarget.value } };
					}}
					class={inputClass}
				/>
			</div>
			<div>
				<label class={labelClass}>Entry point</label>
				<input
					value={value.engine?.entryPoint ?? ""}
					oninput={(e) => {
						value.engine = { ...value.engine!, entryPoint: e.currentTarget.value };
					}}
					class={inputClass}
				/>
			</div>
		</div>
	</details>

	<!-- Meta -->
	<details open class="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800">
		<summary class="px-5 py-3 cursor-pointer text-sm font-semibold">Meta</summary>
		<div class="px-5 pb-4 space-y-3">
			<label class="flex items-center gap-2 text-sm">
				<input type="checkbox" bind:checked={value.meta.public} class="rounded" /> Public
			</label>
			<label class="flex items-center gap-2 text-sm">
				<input type="checkbox" bind:checked={value.meta.needOwnership} class="rounded" /> Requires ownership
			</label>
		</div>
	</details>

	<!-- Description & Rules -->
	<MarkdownEditor bind:value={value.description} label="Description (Markdown)" rows={4} />
	<MarkdownEditor bind:value={value.rules} label="Rules (Markdown)" rows={8} />

	<!-- Expansions, Options, Preferences, Settings -->
	{#each [{ key: "expansions" as const, label: "Expansions", showType: false, showFaction: false, showCategory: false }, { key: "options" as const, label: "Options", showType: true, showFaction: false, showCategory: false }, { key: "preferences" as const, label: "Preferences", showType: true, showFaction: false, showCategory: true }, { key: "settings" as const, label: "Settings", showType: true, showFaction: true, showCategory: false }] as section}
		<details open class="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800">
			<summary class="px-5 py-3 cursor-pointer text-sm font-semibold">{section.label}</summary>
			<div class="px-5 pb-4 space-y-3">
				{#each value[section.key] ?? [] as item, i}
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
									<label class={labelClass}>{section.label.slice(0, -1)} ID</label>
									<input bind:value={(item as OptionItem).name} class={inputClass} />
								</div>
								<div>
									<label class={labelClass}>{section.label.slice(0, -1)} name</label>
									<input bind:value={(item as OptionItem).label} class={inputClass} />
								</div>

								{#if section.showType}
									<div>
										<label class={labelClass}>Type</label>
										<select bind:value={(item as OptionItem).type} class={inputClass}>
											<option value="checkbox">checkbox</option>
											<option value="select">select</option>
											<option value="hidden">hidden</option>
											<option value="category">category</option>
										</select>
									</div>
								{/if}

								{#if section.showType && (item as OptionItem).type === "checkbox" && section.key !== "settings"}
									<div>
										<label class={labelClass}>Default</label>
										<label class="flex items-center gap-2 text-sm mt-2">
											<input type="checkbox" bind:checked={(item as OptionItem).default as boolean} class="rounded" /> Default
											value
										</label>
									</div>
								{/if}

								{#if section.showType && (item as OptionItem).type === "select" && section.key !== "settings"}
									<div>
										<label class={labelClass}>Default</label>
										<select bind:value={(item as OptionItem).default} class={inputClass}>
											{#each (item as OptionItem).items ?? [] as opt}
												<option value={opt.name}>{opt.label}</option>
											{/each}
										</select>
									</div>
								{/if}

								{#if section.showCategory && (item as OptionItem).type !== "category"}
									<div>
										<label class={labelClass}>Category</label>
										<select bind:value={(item as OptionItem).category} class={inputClass}>
											<option value={undefined}>None</option>
											{#each items.filter((x) => x.type === "category") as cat}
												<option value={cat.name}>{cat.label}</option>
											{/each}
										</select>
									</div>
								{/if}

								{#if section.showFaction}
									<div>
										<label class={labelClass}>Faction</label>
										<input bind:value={(item as OptionItem).faction} class={inputClass} />
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
								<span class="text-xs font-semibold text-gray-500">Items for {(item as OptionItem).name || "..."}</span>
								{#each (item as OptionItem).items ?? [] as subItem, j}
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
										<button onclick={() => removeSelectItem(item as OptionItem, j)} class="{btnSmClass} text-red-600"
											>&times;</button
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
	{/each}

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
