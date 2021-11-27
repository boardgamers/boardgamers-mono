<script lang="ts">
  import { browser } from "$app/env";
  import { user } from "@/store";
  import { get, post } from "@/api";
  import { debounce } from "lodash";

  let showNotes = browser ? localStorage.getItem("show-notes") !== "false" : true;

  let notes = "";
  let lastReceivedNotes: string | null = null;
  let notesLoaded = false;
  let textArea: HTMLTextAreaElement;

  let userId: string | undefined;
  export let gameId: string;

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
      if ($user && notes !== lastReceivedNotes) {
        await post(`/game/${gameId}/notes`, { notes });
      }
    },
    800,
    { leading: false, trailing: true }
  );

  $: userId = $user?._id;
  $: loadNotes(), [userId];

  function updateTextareaSize() {
    if (!textArea) {
      return;
    }
    textArea.style.height = "auto";
    textArea.style.height = textArea.scrollHeight + (textArea.offsetHeight - textArea.clientHeight) + "px";
  }
</script>

<div class="mt-75">
  <div class="d-flex align-items-baseline">
    <h3 class="mb-0">Notes</h3>
    <div class="ms-2" style="font-size: smaller">
      (<a
        href={showNotes ? "#hideNotes" : "#showNotes"}
        style="font-weight: unset !important"
        on:click|preventDefault={toggleNotes}>{showNotes ? "hide" : "show"}</a
      >)
    </div>
  </div>

  <textarea
    class={"mt-2 form-control" + (!showNotes ? " d-none" : "")}
    bind:value={notes}
    bind:this={textArea}
    on:input={() => {
      updateNotesDebounce();
      updateTextareaSize();
    }}
    rows="3"
    max-rows="8"
    placeholder="You can make plans here..."
    disabled={!$user || !notesLoaded}
    style="overflow: hidden; resize: none"
  />
</div>
