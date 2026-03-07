<script lang="ts">
	import type { GameInfoFront } from "@bgs/models";

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
					<label class={labelClass}>URL</label>
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
				<label class={labelClass}>Package version</label>
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
	<div>
		<label class={labelClass}>Description</label>
		<textarea bind:value={value.description} rows="4" class={inputClass}></textarea>
	</div>
	<div>
		<label class={labelClass}>Rules (Markdown)</label>
		<textarea bind:value={value.rules} rows="8" class="{inputClass} font-mono"></textarea>
	</div>

	<!-- Expansions, Options, Preferences, Settings -->
	{#each [{ key: "expansions" as const, label: "Expansions", showType: false, showFaction: false, showCategory: false }, { key: "options" as const, label: "Options", showType: true, showFaction: false, showCategory: false }, { key: "preferences" as const, label: "Preferences", showType: true, showFaction: false, showCategory: true }, { key: "settings" as const, label: "Settings", showType: true, showFaction: true, showCategory: false }] as section}
		<details open class="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800">
			<summary class="px-5 py-3 cursor-pointer text-sm font-semibold">{section.label}</summary>
			<div class="px-5 pb-4 space-y-3">
				{#each value[section.key] ?? [] as item, i}
					{@const items = value[section.key] as OptionItem[]}
					<div class="border border-gray-100 dark:border-gray-800 rounded-lg p-3 space-y-2">
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
							<div class="flex flex-col gap-1 pt-5">
								{#if i > 0}
									<button
										onclick={() => moveItem(section.key, i, -1)}
										class="{btnSmClass} text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800"
										title="Move up">&#9650;</button
									>
								{/if}
								{#if i < items.length - 1}
									<button
										onclick={() => moveItem(section.key, i, 1)}
										class="{btnSmClass} text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800"
										title="Move down">&#9660;</button
									>
								{/if}
								<button
									onclick={() => removeListItem(section.key, i)}
									class="{btnSmClass} text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20"
									title="Delete">&times;</button
								>
							</div>
						</div>

						<!-- Select items sub-list -->
						{#if section.showType && (item as OptionItem).type === "select"}
							<div class="ml-4 mt-2 border-l-2 border-gray-200 dark:border-gray-700 pl-4 space-y-2">
								<span class="text-xs font-semibold text-gray-500">Items for {(item as OptionItem).name || "..."}</span>
								{#each (item as OptionItem).items ?? [] as subItem, j}
									<div class="flex gap-2">
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
