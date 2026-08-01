<script lang="ts">
  // A 24h dual-handle range slider for picking a daily active-time span.
  // Supports wrap-around spans (e.g. 22:00–03:00), dragging each handle, and
  // dragging the whole span to move start & end together. Values are "HH:MM".
  let {
    start = $bindable("09:00"),
    end = $bindable("22:00"),
  }: {
    start?: string;
    end?: string;
  } = $props();

  const DAY = 1440;
  const STEP = 30;

  const toMinutes = (t: string) => {
    const [h, m] = t.split(":").map(Number);
    return (h || 0) * 60 + (m || 0);
  };
  const toTime = (mins: number) => {
    const mm = ((mins % DAY) + DAY) % DAY;
    const h = Math.floor(mm / 60);
    const m = mm % 60;
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
  };
  const fmtDuration = (mins: number) => {
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    if (h && m) return `${h}h${String(m).padStart(2, "0")}`;
    if (h) return `${h}h`;
    return `${m}m`;
  };

  let startMin = $derived(toMinutes(start));
  let endMin = $derived(toMinutes(end));
  // Span length, wrapping if end <= start (e.g. 22:00–03:00 → 5h)
  let span = $derived((((endMin - startMin) % DAY) + DAY) % DAY || DAY);
  let startPct = $derived((startMin / DAY) * 100);
  let endPct = $derived((endMin / DAY) * 100);
  let spanPct = $derived((span / DAY) * 100);

  let track = $state<HTMLDivElement>();
  let dragging = $state<"start" | "end" | "span" | null>(null);
  let dragOffset = $state(0); // for span drag: offset of pointer within the span
  let dragSpan = $state(0); // for span drag: frozen span length at drag start

  function minutesFromEvent(e: PointerEvent): number {
    const rect = track!.getBoundingClientRect();
    // Allow pct outside [0,1] so dragging past either edge wraps around the day.
    const pct = (e.clientX - rect.left) / rect.width;
    const mins = Math.round((pct * DAY) / STEP) * STEP;
    return ((mins % DAY) + DAY) % DAY;
  }

  function onHandleDown(which: "start" | "end") {
    return (e: PointerEvent) => {
      e.preventDefault();
      e.stopPropagation();
      dragging = which;
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    };
  }

  function onSpanDown(e: PointerEvent) {
    e.preventDefault();
    dragging = "span";
    dragOffset = minutesFromEvent(e) - startMin;
    dragSpan = span; // freeze the span length so `end` doesn't chase `start` mid-drag
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }

  function onMove(e: PointerEvent) {
    if (!dragging || !track) return;
    const mins = minutesFromEvent(e);
    if (dragging === "start") {
      start = toTime(mins);
    } else if (dragging === "end") {
      end = toTime(mins);
    } else {
      // Move the whole span (frozen length), wrapping around the day
      const newStart = (((mins - dragOffset) % DAY) + DAY) % DAY;
      start = toTime(newStart);
      end = toTime(newStart + dragSpan);
    }
  }

  function onUp() {
    dragging = null;
  }

  const ticks = [0, 6, 12, 18, 24];
</script>

<svelte:window onpointermove={onMove} onpointerup={onUp} />

<div class="select-none">
  <div bind:this={track} class="relative h-9 rounded-md bg-gray-200 dark:bg-gray-700" role="presentation">
    <!-- active span (draggable) -->
    <div
      class="absolute top-0 bottom-0 flex cursor-grab items-center justify-center rounded-md bg-primary/70 text-[0.7rem] font-semibold text-white active:cursor-grabbing {dragging ===
      'span'
        ? 'ring-2 ring-primary-light'
        : ''}"
      style="left: {startPct}%; width: {Math.min(spanPct, 100 - startPct)}%; {spanPct > 100 - startPct
        ? `border-top-right-radius: 0; border-bottom-right-radius: 0;`
        : ''}"
      onpointerdown={onSpanDown}
      role="presentation"
    >
      {#if spanPct >= 12}
        <span class="pointer-events-none">{fmtDuration(span)}</span>
      {/if}
    </div>

    <!-- wrapped tail when the span crosses midnight -->
    {#if startMin + span > DAY}
      <div
        class="absolute top-0 bottom-0 flex cursor-grab items-center justify-center rounded-l-md bg-primary/70 text-[0.7rem] font-semibold text-white"
        style="left: 0%; width: {((startMin + span - DAY) / DAY) * 100}%"
        onpointerdown={onSpanDown}
        role="presentation"
      ></div>
    {/if}

    <!-- hour ticks -->
    {#each ticks as h}
      <div class="absolute top-0 h-full w-px bg-gray-400/60 dark:bg-gray-500/60" style="left: {(h / 24) * 100}%"></div>
      <span
        class="absolute -bottom-4 -translate-x-1/2 text-[0.65rem] text-gray-500 dark:text-gray-400"
        style="left: {(h / 24) * 100}%"
      >
        {String(h).padStart(2, "0")}h
      </span>
    {/each}

    <!-- start handle + label -->
    <div class="absolute top-1/2 z-10 -translate-x-1/2 -translate-y-1/2" style="left: {startPct}%">
      <button
        type="button"
        aria-label="Active from"
        class="block h-6 w-4 cursor-ew-resize rounded-full border-2 border-white bg-primary shadow {dragging === 'start'
          ? 'ring-2 ring-primary-light'
          : ''}"
        onpointerdown={onHandleDown("start")}
      ></button>
      <span
        class="absolute top-full left-1/2 mt-1 -translate-x-1/2 rounded bg-gray-800 px-1 text-[0.65rem] whitespace-nowrap text-white dark:bg-gray-200 dark:text-gray-900"
      >
        {start}
      </span>
    </div>
    <!-- end handle + label -->
    <div class="absolute top-1/2 z-10 -translate-x-1/2 -translate-y-1/2" style="left: {endPct}%">
      <button
        type="button"
        aria-label="Active until"
        class="block h-6 w-4 cursor-ew-resize rounded-full border-2 border-white bg-primary shadow {dragging === 'end'
          ? 'ring-2 ring-primary-light'
          : ''}"
        onpointerdown={onHandleDown("end")}
      ></button>
      <span
        class="absolute top-full left-1/2 mt-1 -translate-x-1/2 rounded bg-gray-800 px-1 text-[0.65rem] whitespace-nowrap text-white dark:bg-gray-200 dark:text-gray-900"
      >
        {end}
      </span>
    </div>
  </div>

  <div class="mt-7 text-sm text-gray-600 dark:text-gray-300">
    🌙 Clock runs <b>{start}</b> – <b>{end}</b> ({fmtDuration(span)}), pauses overnight.
  </div>
</div>
