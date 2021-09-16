<script lang="ts">
  import { user } from "@/store";
  import { get, post } from "@/api";
  import { debounce } from "lodash";
  import { Input } from "@/modules/cdk";

  let showNotes = localStorage.getItem("show-notes") !== "false";

  let notes = "";
  let lastReceivedNotes: string | null = null;
  let notesLoaded = false;

  let userId: string | undefined;
  export let gameId: string;

  async function loadNotes() {
    if (userId) {
      lastReceivedNotes = notes = await get(`/game/${gameId}/notes`);
      notesLoaded = true;
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
</script>

<div class="mt-75">
  <div class="d-flex align-items-baseline">
    <h3 class="mb-0">Notes</h3>
    <div class="ms-2" style="font-size: smaller">
      (<a href="#" style="font-weight: unset !important" on:click|preventDefault={toggleNotes}
        >{showNotes ? "hide" : "show"}</a
      >)
    </div>
  </div>

  <Input
    type="textarea"
    class={"mt-2 vertical-textarea" + (!showNotes ? " d-none" : "")}
    bind:value={notes}
    on:input={updateNotesDebounce}
    rows="3"
    max-rows="8"
    placeholder="You can make plans here..."
    disabled={!$user || !notesLoaded}
  />
</div>
