///<reference types="svelte" />
;
import { browser } from "$app/environment";
import { debounce } from "lodash";
import { get, post } from "@/lib/api";
import { account } from "@/lib/stores.svelte";
function $$render() {
/*Ωignore_startΩ*/;let $account = __sveltets_2_store_get(account);/*Ωignore_endΩ*/
  
  
  
  

  let showNotes = browser ? localStorage.getItem("show-notes") !== "false" : true;

  let notes = "";
  let lastReceivedNotes: string | null = null;
  let notesLoaded = false;
  let textArea: HTMLTextAreaElement;

  let userId: string | undefined;
   let gameId: string/*Ωignore_startΩ*/;gameId = __sveltets_2_any(gameId);/*Ωignore_endΩ*/;

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

  $: userId = __sveltets_2_invalidate(() => $account?._id);
  ;() => {$: (loadNotes(), [userId, gameId]);}

  function updateTextareaSize() {
    if (!textArea) {
      return;
    }
    textArea.style.height = "auto";
    textArea.style.height = textArea.scrollHeight + (textArea.offsetHeight - textArea.clientHeight) + "px";
  }
;
async () => {

 { svelteHTML.createElement("div", { "class":`mt-75`,});
   { svelteHTML.createElement("div", { "class":`d-flex align-items-baseline`,});
     { svelteHTML.createElement("h3", { "class":`mb-0`,});  }
     { svelteHTML.createElement("div", {   "class":`ms-2`,"style":`font-size: smaller`,});
       { svelteHTML.createElement("a", {      "href":showNotes ? "#hideNotes" : "#showNotes","style":`font-weight: unset !important`,"on:click":toggleNotes,});showNotes ? "hide" : "show"; }
     }
   }

   { const $$_textarea1 = svelteHTML.createElement("textarea", {                  "class":"mt-2 form-control" + (!showNotes ? " d-none" : ""),"bind:value":notes,"on:input":() => {
      updateNotesDebounce();
      updateTextareaSize();
    },"rows":3,"max-rows":`8`,"placeholder":`You can make plans here...`,"disabled":!$account || !notesLoaded,"style":`overflow: hidden; resize: none`,});/*Ωignore_startΩ*/() => notes = __sveltets_2_any(null);/*Ωignore_endΩ*/textArea = $$_textarea1;}
 }
};
return { props: {gameId: gameId} as {gameId: string}, exports: {}, bindings: "", slots: {}, events: {} }}
const GameNotes__SvelteComponent_ = __sveltets_2_isomorphic_component(__sveltets_2_with_any_event($$render()));
/*Ωignore_startΩ*/type GameNotes__SvelteComponent_ = InstanceType<typeof GameNotes__SvelteComponent_>;
/*Ωignore_endΩ*/export default GameNotes__SvelteComponent_;