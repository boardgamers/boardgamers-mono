///<reference types="svelte" />
;
import type { Page as IPage } from "@bgs/models";
import marked from "marked";
function $$render() {

  
  

   let pageContent: Partial<IPage>/*Ωignore_startΩ*/;pageContent = __sveltets_2_any(pageContent);/*Ωignore_endΩ*/;
;
async () => {

 { svelteHTML.createElement("svelte:head", {});
   { svelteHTML.createElement("title", {});pageContent.title; }
 }

 { svelteHTML.createElement("article", { "class":`page container`,});
   { svelteHTML.createElement("h1", {});pageContent.title; }
   { svelteHTML.createElement("div", {});
     marked(pageContent.content ?? "");
   }
 }


};
return { props: {pageContent: pageContent} as {pageContent: Partial<IPage>}, exports: {}, bindings: "", slots: {}, events: {} }}
const Page__SvelteComponent_ = __sveltets_2_isomorphic_component(__sveltets_2_with_any_event($$render()));
/*Ωignore_startΩ*/type Page__SvelteComponent_ = InstanceType<typeof Page__SvelteComponent_>;
/*Ωignore_endΩ*/export default Page__SvelteComponent_;