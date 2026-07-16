<script lang="ts">
  import { browser } from "$app/environment";
  import { debounce } from "lodash";
  import { get, post } from "@/lib/api";
  import { account } from "@/lib/stores.svelte";

  let showNotes = $state(browser ? localStorage.getItem("show-notes") !== "false" : true);

  let notes = $state("");
  let lastReceivedNotes = $state<string | null>(null);
  let notesLoaded = $state(false);
  let textArea: HTMLTextAreaElement;

  let userId = $derived($account?._id);
  let { gameId }: { gameId: string } = $props();

  async function loadNotes() {
    if (userId) {
      lastReceivedNotes = notes = await get(`/game/${gameId}/notes`);
      notesLoaded = true;
      updateTextareaSize();
      setTimeout(updateTextareaSize);
    }
  }

  function toggleNotes() {
    showNotes = !showNotes;
    localStorage.setItem("show-notes", showNotes ? "true" : "");
  }

  let updateNotesDebounce = debounce(
    async () => {
      if ($account && notes !== lastReceivedNotes) {
        await post(`/game/${gameId}/notes`, { notes });
      }
    },
    800,
    { leading: false, trailing: true }
  );

  // Initial load: run synchronously during component init so SSR has data.
  loadNotes();

  let firstRun = true;

  $effect(() => {
    userId;
    gameId;
    // Skip the first run — initial load already happened synchronously above.
    if (firstRun) {
      firstRun = false;
      return;
    }
    loadNotes();
  });

  function updateTextareaSize() {
    if (!textArea) {
      return;
    }
    textArea.style.height = "auto";
    textArea.style.height = textArea.scrollHeight + (textArea.offsetHeight - textArea.clientHeight) + "px";
  }
</script>

<div class="mt-3">
  <div class="flex items-baseline">
    <h3 class="mb-0">Notes</h3>
    <div class="ms-2" style="font-size: smaller">
      (<a
        href={showNotes ? "#hideNotes" : "#showNotes"}
        class="no-underline"
        style="font-weight: unset"
        onclick={(e) => {
          e.preventDefault();
          toggleNotes(e);
        }}>{showNotes ? "hide" : "show"}</a
      >)
    </div>
  </div>

  <textarea
    class={"mt-2 w-full rounded-md border border-gray-300 px-3 py-2 dark:border-gray-600 dark:bg-gray-800" +
      (!showNotes ? " hidden" : "")}
    bind:value={notes}
    bind:this={textArea}
    oninput={() => {
      updateNotesDebounce();
      updateTextareaSize();
    }}
    rows="3"
    max-rows="8"
    placeholder="You can make plans here..."
    disabled={!$account || !notesLoaded}
    style="overflow: hidden; resize: none"
  ></textarea>
</div>
